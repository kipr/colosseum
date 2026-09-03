# Local PostgreSQL Migration — Design and Implementation Plan

Status: approved, not yet implemented. Work in numbered phases; each phase should be a mergeable PR.

Replace local SQLite with a Docker Compose PostgreSQL 18 server so development, the devcontainer, Vitest, and local Playwright all use the same dialect as production (Cloud SQL Postgres 18). The long-term goal is one schema, one query dialect, and no adapter translation that only exists to paper over SQLite.

GitHub Actions Playwright remains **out of scope**. Local Playwright is **in scope** and must use the test database, not the developer’s `colosseum` database.

---

## 1. Motivation

### 1.1 What exists today

| Environment | Engine | How it is chosen |
| --- | --- | --- |
| Local `npm run dev` | SQLite files under `database/` (`colosseum.db`, `sessions.db`) | Default when `DATABASE_URL` is unset and `NODE_ENV !== 'production'` |
| Vitest | In-memory SQLite via `better-sqlite3` | `tests/sql/helpers/testDb.ts` |
| Local Playwright | SQLite files, written with `better-sqlite3` while the server runs | `e2e/*.spec.ts` open `database/colosseum.db` |
| Production | Cloud SQL PostgreSQL 18 | `NODE_ENV=production` or `DATABASE_URL`; Cloud Run uses `DB_USER` / `DB_PASSWORD` / `DB_NAME` / `CLOUD_SQL_CONNECTION_NAME` |

Schema is duplicated in 13 modules under `src/server/database/schema/` (`postgres` and `sqlite` blocks). `PostgresAdapter.convertSql()` rewrites `?` placeholders, `INSERT OR IGNORE`, and appends `RETURNING id` on inserts. `tests/server/database/postgresParity.test.ts` only regex-matches emitted SQL; it never talks to Postgres.

Sessions are a second store: custom `SqliteSessionStore` in development, `connect-pg-simple` on table `"session"` in production.

### 1.2 Why the adapter is not enough

- **Write-path translation, no read-path normalization.** Params are massaged; rows are not. `pg` returns `Date` for timestamps and real booleans; SQLite returns strings and `0/1`. Production JSON already looks like Postgres. Tests do not.
- **`RETURNING id` is appended to every INSERT**, then the error is swallowed if the table has no `id` (for example `queue_versions` uses `event_id` as PK).
- **Boolean CHECK constraints differ** (`is_bye = TRUE` vs `is_bye = 1`). Application code still writes `is_bye ? 1 : 0`.
- **Schema drift is cheap.** `DATETIME` vs `TIMESTAMP`, `SERIAL` vs `AUTOINCREMENT`, `BIGINT` vs `INTEGER` for `token_expires_at`, Postgres `DO $$` blocks vs inline SQLite FKs, different trigger syntax.
- **Tests never exercise `PostgresAdapter`.** Dialect bugs show up in prod.

Keeping SQLite “just for tests” would preserve that class of bug. Vitest and local Playwright must run against Postgres.

### 1.3 Non-goals

- Dockerizing the Node app for everyday `npm run dev` (Postgres in Compose; Node stays on the host or in the existing Node devcontainer)
- Changing Cloud Run / Cloud SQL wiring (`cloudbuild.yaml` stays)
- A production data migration (prod is already Postgres 18)
- An ORM
- Preserving local SQLite files (dev data can be wiped)
- Running Playwright in GitHub Actions CI

---

## 2. Locked decisions

| Topic | Choice |
| --- | --- |
| Postgres image | `postgres:18`, matching Cloud SQL |
| Result types | Whatever `pg` already returns in production (`Date` for timestamps, real booleans, BIGINT as string when `pg` does that). Tests follow prod, not old SQLite shapes. |
| Vitest isolation | Unique schema per `createTestDb()` on database `colosseum_test` |
| SQLite during Phases 0–1 | Keep today’s fallback (`no DATABASE_URL` → SQLite) until Phase 2 |
| Devcontainer | Compose siblings: Node `app` + `postgres` |
| GitHub Playwright | Out of scope |
| Local Playwright | Own API/Vite process, `DATABASE_URL=$TEST_DATABASE_URL`, dedicated ports, never the `colosseum` dev database |
| Connection selection after SQLite is gone | `DATABASE_URL` → TCP; Cloud SQL env vars → Unix socket; otherwise fail with a `db:up` hint. Do not use `NODE_ENV === 'production'` as a proxy for “use Postgres”. |

---

## 3. Target architecture

```
┌──────────────────────────────────────┐     ┌─────────────────────────────┐
│  Node (host or devcontainer)         │────▶│  Postgres 18 in Compose     │
│  npm run dev     → colosseum         │     │  DB colosseum       (dev)   │
│  npm run test    → colosseum_test    │     │  DB colosseum_test  (tests) │
│  npm run test:e2e → colosseum_test   │     └─────────────────────────────┘
└──────────────────────────────────────┘
```

- **One dialect, one schema path.** `runSchema(db, schemaModules)` with no `SchemaDialect`.
- **One session store:** `connect-pg-simple` against `"session"` (already in the Postgres schema).
- **Keep the `Database` interface** (transactions, `__setTestDatabaseAdapter`, `?` placeholders) so application SQL does not have to be rewritten in the same change. Shrink the magic after SQLite is gone.

### 3.1 Compose

Root `docker-compose.yml`, Postgres only:

- Image: `postgres:18`
- User / password / database: `colosseum` / `colosseum` / `colosseum` (dev-only credentials)
- Init script also `CREATE DATABASE colosseum_test;`
- Named volume for data; healthcheck via `pg_isready`
- Publish `5432` for host Node; on the Compose network the hostname is the service name (`postgres`)

No Adminer/pgAdmin. Use `npm run db:psql`.

### 3.2 Environment

`.env.example` (host / local Node):

```env
DATABASE_URL=postgres://colosseum:colosseum@localhost:5432/colosseum
TEST_DATABASE_URL=postgres://colosseum:colosseum@localhost:5432/colosseum_test
```

Inside the devcontainer, host is `postgres`, not `localhost`.

### 3.3 npm scripts

| Script | Purpose |
| --- | --- |
| `db:up` | `docker compose up -d postgres` |
| `db:wait` | wait until `pg_isready` succeeds |
| `db:down` | `docker compose down` |
| `db:reset` | `down -v` then `up -d` (wipe local data) |
| `db:psql` | `docker compose exec postgres psql -U colosseum -d colosseum` |

Do **not** auto-start Compose from `npm run dev`. Docker-daemon failures are clearer as an explicit `db:up`. After Phase 2, `dev:server` must fail fast if Postgres is unreachable, with a message pointing at `db:up`.

### 3.4 Devcontainer

Today `.devcontainer/devcontainer.json` builds a single Node image. Switch to Compose so the app container and Postgres are siblings:

- `.devcontainer/docker-compose.yml` defines `app` (existing Dockerfile) and includes the root Compose file
- `devcontainer.json` uses `dockerComposeFile: ["../docker-compose.yml", "docker-compose.yml"]` and `service: "app"`
- Container env: `DATABASE_URL` and `TEST_DATABASE_URL` with hostname `postgres`
- Keep port forwards `3000` / `5173`; add `5432` if host tools should hit the same DB
- `postCreateCommand`: `npm ci` (and Playwright deps as today)
- `postStartCommand`: wait until Postgres is healthy
- Later (Phase 3), drop `python3` / `make` / `g++` from the image once `better-sqlite3` is gone (Playwright deps stay)

Local-without-devcontainer remains: `docker compose up -d` + `npm run dev` on the host.

---

## 4. Tests

### 4.1 Vitest (`colosseum_test`, unique schemas)

Do not keep in-memory SQLite for unit tests.

1. CI and local tests use `TEST_DATABASE_URL` → database `colosseum_test`.
2. `createTestDb()` creates a unique schema (`test_<id>`), `SET search_path`, runs `initializePostgres`, returns `{ db, close }` where `close` drops the schema.
3. HTTP/service tests keep injecting that adapter via `__setTestDatabaseAdapter`. Most test bodies should not need a rewrite beyond helper internals.
4. Replace `sqlite_master` / `pragma_table_info` assertions with `information_schema` / `pg_indexes`.
5. Delete `postgresParity.test.ts` once schema tests hit a real server.
6. Delete `SqliteSessionStore` tests with the store (Phase 3).
7. Add real `PostgresAdapter` tests (placeholders, transactions, `lastID`, rollback, boolean/timestamp reads).

Each Vitest helper uses its own pooled connection with `search_path` set to that test’s schema so connections cannot leak rows into `public` (where e2e lives).

GitHub Actions (`.github/workflows/ci.yml`): add a `postgres:18` service with a healthcheck, set `TEST_DATABASE_URL`, keep `npm run test:run`. No Playwright job.

Vitest currently forces sequential runs for `better-sqlite3`. After the switch, start sequential to reduce flakes; enable `fileParallelism` later (one schema per file).

**Expect failures that are actually prod bugs.** Fix application code to match production Postgres:

- Timestamp columns as `Date` vs string
- `is_admin` / `is_bye` / `is_active` as `true`/`false` vs `0`/`1`
- `token_expires_at` BIGINT (sometimes a string from `pg`) vs number
- CHECK constraints that only existed on one dialect

Do not add `pg` type parsers that make Postgres look like SQLite.

### 4.2 Local Playwright (`colosseum_test`, `public` schema)

GitHub Playwright is out of scope. Local `npm run test:e2e` must never touch database `colosseum`.

Today Playwright will reuse a server already on port 3000 (`reuseExistingServer: !process.env.CI`). After Phase 2 that server is the developer’s tournament data. Reusing it would seed and delete against the wrong database.

**Rules:**

- Playwright always starts its **own** Express process with `DATABASE_URL=$TEST_DATABASE_URL`.
- `reuseExistingServer: false` for that API (and for its Vite instance).
- Dedicated ports so `npm run dev` can keep running: API **3001**, Vite **5174**.
- Drive Vite’s proxy target from env (today every proxy entry is hardcoded to `http://localhost:3000` in `vite.config.ts`).
- `baseURL` becomes `http://localhost:5174`.
- Shared e2e helper uses `pg` against `TEST_DATABASE_URL`. Seed users/events/templates via SQL. Admin login: insert into `"session"` in the shape `connect-pg-simple` expects (`sid`, `sess` JSON, `expire`), then set the signed `connect.sid` cookie as today.
- Cleanup/truncate happens on `colosseum_test` only.
- Stop importing `better-sqlite3` from `e2e/`.

Vitest and e2e can share `colosseum_test` without colliding: Vitest uses ephemeral `test_<id>` schemas; e2e uses `public`.

If port 3001/5174 is taken, fail with a clear message rather than silently attaching to the dev stack.

---

## 5. Schema collapse

Once nothing runs SQLite:

- `SchemaModule` loses `sqlite` / `postgres` keys; one `DialectSchema` per module
- `runner.ts` keeps phases: tables → additive columns → constraints → updated_at triggers → extra triggers → indexes
- Keep additive `columns` and idempotent `DO $$` constraint blocks — those are for **existing Cloud SQL instances**, not for SQLite
- Postgres-only trigger functions stay (`update_updated_at_column`, `teams_clear_checked_in_at`)
- Docs that say “edit both dialect blocks” (`docs/BRACKET_ORDER.md`, `docs/QUEUE_TRACKING.md`, `AGENTS.md`, Serena memories) get updated

Mechanical diffs per file are large but boring: delete the `sqlite:` half of `events.ts`, `brackets.ts`, `scoring.ts`, and the rest.

---

## 6. Adapter simplification (after SQLite is gone)

Keep:

- `Database` / `Transaction` async API
- `?` → `$n` conversion so application SQL does not have to be rewritten in the same change
- `getPostgresPool()` for the session store
- `__setTestDatabaseAdapter` for tests
- Cloud SQL unix-socket config for production

Remove:

- `SqliteAdapter`, `createSqliteDatabase`, `better-sqlite3`
- `SqliteSessionStore`
- `INSERT OR IGNORE` rewriting (no callers in app SQL today)
- Blind `RETURNING id` + catch-and-retry; either always `RETURNING id` on known-id tables, or require `RETURNING` in the SQL

Then audit remaining SQLite-shaped writes (`is_bye ? 1 : 0`, `is_championship ? 1 : 0`) and pass real booleans.

`package.json` / lockfile drop `better-sqlite3` and `@types/better-sqlite3`. Production `Dockerfile` can drop `mkdir -p /app/database`.

---

## 7. Docs and agent instructions

Update together so the next agent does not recreate SQLite:

- `README.md` prerequisites: Docker + Compose; setup becomes `docker compose up -d` then `npm run dev`
- `AGENTS.md`: replace “mkdir database” / “SQLite locally” with Compose + `DATABASE_URL` / `TEST_DATABASE_URL`
- `.env.example`, `docs/API_TESTING.md` (`sqlite3 database/colosseum.db` → `psql`)
- `.gitignore`: keep ignoring `database/*.db` during transition, then drop
- Serena memories: `server/core.md`, `conventions.md`, `task_completion.md`

Cursor Cloud agents need Docker Compose. Do not reintroduce SQLite as a Cloud-agent escape hatch; if Compose is unavailable, document that the environment cannot run DB-backed commands.

---

## 8. Phases

Each phase should be mergeable on its own.

### Phase 0 — Postgres available, SQLite still default

- Add `docker-compose.yml`, init SQL for `colosseum_test`, `db:*` scripts, `.env.example` comments
- Wire the **devcontainer** to Compose + `DATABASE_URL` so Codespaces/devcontainers can opt in immediately
- Document “set `DATABASE_URL` to use local Postgres”
- **Do not** change the default yet — e2e still writes SQLite files

Mostly new files; almost no runtime risk. Setting `DATABASE_URL` today already selects `PostgresAdapter` + `initializePostgres` + `connect-pg-simple`.

### Phase 1 — Tests and local e2e on Postgres

- `createTestDb()` → schema-per-test on `colosseum_test`
- Rewrite sqlite-catalog assertions
- CI Postgres 18 service + `TEST_DATABASE_URL` (Vitest only)
- Playwright: `pg` helper, `TEST_DATABASE_URL`, ports 3001/5174, env-driven Vite proxy, `reuseExistingServer: false`; delete SQLite file access
- Adapter tests against real Postgres
- Fix type/constraint mismatches that surface (these are the prod bugs)

Until this lands, local `DATABASE_URL` on the default ports and e2e cannot both be the documented default.

### Phase 2 — Postgres is the only local default

- `getDatabase()` / `initializeDatabase()` / `server.ts` session store: Postgres only
- Fail fast with a Compose hint if the server is unreachable
- Remove SQLite session branch
- Update README / AGENTS.md / `.env.example` as required
- Keep schema `sqlite:` blocks temporarily so a revert is still possible if needed

### Phase 3 — Delete the second dialect

- Collapse schema modules
- Delete `SqliteAdapter`, `SqliteSessionStore`, `better-sqlite3`
- Slim the devcontainer image
- Replace `postgresParity.test.ts` with real schema tests if not already done
- `vitest.config.ts`: drop sequential-SQLite comments; reconsider `fileParallelism`

### Phase 4 — Reduce adapter magic

- Explicit `RETURNING` / boolean params
- Remove coverage excludes for `connection.ts` / `init.ts` if tests now cover them
- Pass native booleans from routes/services instead of `? 1 : 0`

---

## 9. Risks

| Risk | Mitigation |
| --- | --- |
| E2e vs default-Postgres ordering | Phase 1 before Phase 2 |
| Playwright attaching to `npm run dev` | Dedicated ports 3001/5174, `reuseExistingServer: false`, `DATABASE_URL=$TEST_DATABASE_URL` |
| `pg` `Date` / boolean JSON vs SQLite-shaped tests | Treat Postgres as source of truth; fix app + client assumptions |
| Unique-schema isolation slower than `:memory:` | Acceptable at this DB size; `search_path` must not leak across pooled connections |
| Docker required for `npm test` / `test:e2e` | Document it; CI service container for Vitest; fail with a `db:up` message |
| Cursor Cloud agents without Docker | Call out in `AGENTS.md`; do not reintroduce SQLite |
| Cloud SQL major version drift | Pin Compose to `postgres:18` |
| Local data loss | Dev SQLite files are not migrated; `db:reset` is explicit |
| Port 5432 already in use | Document a compose `ports` override |
| Vitest and e2e sharing `colosseum_test` | Vitest ephemeral schemas vs e2e `public` |

---

## 10. Success criteria

- `docker compose up -d && npm run dev` is the documented local path; no `database/*.db`
- Devcontainer boots with working API + Postgres 18, no extra SQLite install
- `npm run test:run` talks only to Postgres (`colosseum_test`, unique schemas)
- Local `npm run test:e2e` talks only to `colosseum_test` on ports 3001/5174 and can run while `npm run dev` uses `colosseum` on 3000/5173
- Playwright is **not** added to GitHub Actions
- A single schema definition; `SchemaDialect` / `sqlite:` blocks gone
- `better-sqlite3` not in `package.json`
- CI Vitest uses a Postgres 18 service
- Production deploy path unchanged

---

## 11. Key files (current)

| Area | Path |
| --- | --- |
| Adapter / connection | `src/server/database/connection.ts` |
| Init | `src/server/database/init.ts` |
| Schema modules | `src/server/database/schema/*.ts` |
| Schema runner | `src/server/database/schema/runner.ts` |
| Session (SQLite) | `src/server/session/SqliteSessionStore.ts` |
| Session (server wiring) | `src/server/server.ts` |
| Test DB helper | `tests/sql/helpers/testDb.ts` |
| Postgres “parity” (string match) | `tests/server/database/postgresParity.test.ts` |
| E2E (SQLite file access) | `e2e/*.spec.ts`, `playwright.config.ts` |
| Vite proxy (hardcoded :3000) | `vite.config.ts` |
| CI | `.github/workflows/ci.yml` |
| Devcontainer | `.devcontainer/devcontainer.json`, `.devcontainer/Dockerfile` |
| Prod image | `Dockerfile`, `cloudbuild.yaml` |
