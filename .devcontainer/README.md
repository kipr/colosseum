# Colosseum devcontainer

Node 24 (matches `engines`, `.nvmrc` and CI) plus a sibling `postgres:18`
Compose service, matching CI and Cloud SQL. It needs nothing from the host
except the repo checkout.

## Layout

| File | What it defines |
|------|-----------------|
| `../Dockerfile`, stage `dev` | The image. Built from the same `toolchain` stage as the production build, so the Node pin lives in one place. The default target is still the production image. |
| `../docker-compose.yml` | The `postgres` service (shared with `npm run db:up` on the host). |
| `docker-compose.yml` | Overlay adding the `app` service: published ports, workspace mount, database URLs, agent volumes, security options. |
| `devcontainer.json` | Editor settings and lifecycle commands. |

## What's in the image

- Debian trixie (`node:24-trixie`), user `code` (UID/GID 1000, home
  `/home/code`), passwordless sudo, fish shell. On hosts where your UID is not
  1000 the devcontainer CLI / VS Code remaps it on start.
- git, curl, wget, jq, openssh-client, ripgrep, fd, fzf, `postgresql-client`
  (`pg_isready`/`psql` against the `postgres` service).
- Playwright Chromium and its OS libraries, pinned by `PLAYWRIGHT_VERSION` in
  the Dockerfile. Keep it in sync with `@playwright/test` in
  `package-lock.json` and rebuild after a Playwright upgrade.
- Claude Code (`claude`) and Codex (`codex`) CLIs, and `bubblewrap` for their
  command sandbox.

The repo is mounted at `/workspaces/colosseum`. `node_modules` lives in the
repo, so the host and container share it; run `npm ci` again if you switch
between a non-Linux host and the container, and `npm run clean` when switching
build directories between them.

## Open it

VS Code: "Dev Containers: Reopen in Container". CLI: `devcontainer up --workspace-folder .`.
Zed: "Project: Open Remote", then "Connect Dev Container".

Rebuild ("Dev Containers: Rebuild Container", or
`devcontainer up --workspace-folder . --remove-existing-container`) after
changing the Dockerfile, either compose file, or `devcontainer.json`.

Postgres is already running as `postgres`, and `DATABASE_URL` /
`TEST_DATABASE_URL` are preset in the Compose overlay (they take precedence
over `.env`). Do **not** use `npm run db:up` / `db:wait` inside the container:
there is no Docker CLI in it.

Git identity and credentials need no setup: VS Code copies the host git config
and forwards the credential helper and SSH agent.

## Ports and Zed

The Compose overlay publishes these ports to the same ports on the host:

| Service | Port | Starts with |
|---------|------|-------------|
| Express API | 3000 | `npm run dev` |
| Vite frontend | 5173 | `npm run dev` |
| Playwright API | 3001 | `npm run test:e2e` |
| Playwright frontend | 5174 | `npm run test:e2e` |

Opening the container starts PostgreSQL. Run `npm run dev` in the container
to start the app, then open `http://localhost:5173` on the host.

Zed can reuse a container originally created by VS Code. In Zed 1.28.1,
reopening a running container keeps its existing configuration; resuming a
stopped Compose container uses `--no-recreate`. Port changes therefore need
a container recreation. Stopping and reopening the container is insufficient.
See [Zed's container resume implementation](https://github.com/zed-industries/zed/blob/e8bc16acee5ae1937600d571d441c4b5d7b0d288/crates/dev_container/src/devcontainer_manifest.rs#L2447).

After changing port mappings, close the container's editor windows and run
this from the repo root on the host, then reconnect in Zed:

```sh
devcontainer up --workspace-folder . --remove-existing-container
docker compose -f docker-compose.yml -f .devcontainer/docker-compose.yml ps app
```

The `PORTS` column should show host mappings for 3000, 5173, 3001 and 5174.
If it is empty, inspect the actual bindings with
`docker inspect colosseum-app-1 --format '{{json .HostConfig.PortBindings}}'`.
An empty object means the container has no published ports, even if the
current Compose files declare them.

## Commands (inside the container)

```sh
npm ci
npm run pretty
npm run lint
npm run typecheck:client && npm run typecheck:server
npm run test:run
npm run build
npm run test:e2e
npm run dev
```

## Standalone build and test

From the repo root on the host, without VS Code:

```sh
docker build --target dev .

alias dc='docker compose -f docker-compose.yml -f .devcontainer/docker-compose.yml'
dc config --quiet
dc build app
dc run --rm -w /workspaces/colosseum app sh -c 'npm ci && npm run test:run && npm run build'
```

## Agent CLIs

Agent state lives in two named Docker volumes, not in host directories:

| Agent | Volume | Mounted at |
|-------|--------|------------|
| Claude Code | `claude-config` | `/home/code/.claude` (`CLAUDE_CONFIG_DIR`) |
| Codex | `codex-config` | `/home/code/.codex` (`CODEX_HOME`) |

The volume names are fixed, so every devcontainer on the machine that follows
this convention shares them: log in once per machine and the login survives
rebuilds. First time:

```sh
claude          # then /login
codex login
```

Smoke test:

```sh
claude --version && claude -p "say hi"
codex --version && codex login status && codex sandbox -- echo "sandbox works"
```

Host-level agent config (user settings, skills, plugins, memories, sessions) is
deliberately not shared with the container. Project-level config (`.claude/`,
`AGENTS.md`) arrives with the workspace. MCP servers and hooks configured
inside a volume need their executables in the image.

## Caveats

- `seccomp=unconfined` and `systempaths=unconfined` on the `app` service let
  the agent CLIs create their bubblewrap sandbox. They disable Docker's syscall
  filter and its masked/read-only system paths for that container.
- Containers share the agent volumes live, so concurrent sessions in two
  containers write the same files.
- Compose warns that `claude-config` / `codex-config` "already exists but was
  created for project …" when another project created them first. That is the
  sharing working as intended.
- Postgres is published on host port 5432; stop any local Postgres first.
- SELinux hosts: with Docker the workspace mount works unlabeled. With Podman,
  or a Docker daemon running with SELinux enabled, the workspace may be denied;
  add `label=disable` to `security_opt` in the overlay if so.
