# Colosseum devcontainer

Node 24 (matches `engines`, CI and the production Dockerfile) plus a sibling
`postgres:18` Compose service, matching CI and Cloud SQL.

## What's in the image

- Debian trixie (`node:24-trixie`), non-root user matching your host user
  (name, UID/GID and **home path**), passwordless sudo, fish shell.
- git, curl, openssh-client, ripgrep, fd, fzf, `postgresql-client`
  (`pg_isready`/`psql` against the `postgres` service).
- Playwright Chromium and its OS libraries, baked in at `/opt/pw-browsers`
  (pinned by `PLAYWRIGHT_VERSION` in the Dockerfile; keep it in sync with
  `@playwright/test` in `package-lock.json`).
- Claude Code (`claude`) and Codex (`codex`) CLIs.

## Mounts

| Host | Container | Why |
|------|-----------|-----|
| repo (`${localWorkspaceFolder}`) | same path | Host-identical path: `node_modules`, host LSPs and Claude sessions/memory (keyed by path) all line up. |
| `~/.claude`, `~/.claude.json` | same paths | Claude settings, memory, sessions, plugins and login are shared live with the host. |
| `~/.config/codex` | `~/.codex` | Codex config/login. |

`initializeCommand` creates the host paths so Docker doesn't create them as root.
Host and container Claude sessions write the same files at the same time.
On macOS, Claude credentials live in the keychain; run `claude` login once inside the container.

`node_modules` lives in the repo, so the host and container share it. Both are
Linux/x86-64-style glibc environments, but if you switch architectures or OSes
run `npm ci` again. Use clean build dirs (`npm run clean`) when switching
between host and container.

## Open it

VS Code: "Dev Containers: Reopen in Container". CLI: `devcontainer up --workspace-folder .`.
Rebuild the container after changing mounts, the Dockerfile or compose files.

Postgres is already running as `postgres` and `DATABASE_URL` / `TEST_DATABASE_URL`
are preset. Do **not** use `npm run db:up` / `db:wait` inside the container (no Docker CLI).

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

## Standalone build

```sh
LOCAL_UID=$(id -u) LOCAL_GID=$(id -g) \
  docker compose -f docker-compose.yml -f .devcontainer/docker-compose.yml build app
```

The build args default to `$USER` and `$HOME`; `LOCAL_UID`/`LOCAL_GID` default to 1000.

## Caveats

- `label=disable` in the compose file is for SELinux hosts (bind mounts without relabeling).
- Postgres is published on host port 5432; stop any local Postgres first.
- After a Playwright upgrade, `postCreateCommand` fetches the matching Chromium; update the pinned version too.
