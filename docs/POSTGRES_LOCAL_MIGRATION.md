# Local PostgreSQL Migration — Design and Implementation Plan

Status: Phases 0–4 implemented (1a Vitest + CI, 1b local Playwright, 2 Postgres-only local default, 3 SQLite dialect deleted, 4 adapter magic reduced). Work in numbered phases; each phase should be a mergeable PR.

Replace local SQLite with a Docker Compose PostgreSQL 18 server so local Node, the devcontainer, Vitest, and local Playwright all use the same dialect as production (Cloud SQL Postgres 18). The long-term goal is one schema, one query dialect, and no adapter translation that only exists to paper over SQLite.

GitHub Actions Playwright remains **out of scope**. Local Playwright is **in scope** and must use the test database, not the developer’s `colosseum` database.

---

## 1. Motivation

### 1.1 What exists today

| Environment | Engine | How it is chosen |
| --- | --- | --- |
| Local `npm run dev` | PostgreSQL 18 via Docker Compose (`colosseum`) | `DATABASE_URL` (required). Unset + no Cloud SQL vars → fail with a `db:up` hint. `NODE_ENV` is not a dialect signal |
| Vitest | PostgreSQL 18, schema per worker on `colosseum_test` | `TEST_DATABASE_URL` (`tests/sql/helpers/testDb.ts`) |
| Local Playwright | PostgreSQL 18, `public` schema on `colosseum_test` | Playwright injects `DATABASE_URL=$TEST_DATABASE_URL`; ports 3001/5174 |
| Production | Cloud SQL PostgreSQL 18 | `DB_HOST` (private-IP TCP) or `CLOUD_SQL_CONNECTION_NAME` (Unix socket) + `DB_USER` / `DB_PASSWORD` / `DB_NAME` (Cloud Run does **not** set `DATABASE_URL`) |

Schema is defined once in 13 modules under `src/server/database/schema/` (`SchemaModule` is a name plus one `DialectSchema`). `PostgresAdapter.convertSql()` rewrites `?` placeholders to `$n`. Callers that need a generated key include `RETURNING id` in the SQL; the adapter does not append it and does not rewrite `INSERT OR IGNORE`.

The running app uses `connect-pg-simple` on table `"session"`.

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
| SQLite during Phases 0–1 | Fallback (`no DATABASE_URL` → SQLite) until Phase 2. Phase 2 removed that fallback |
| SQLite after Phase 3 | Removed. One schema module, `pg` only, `connect-pg-simple`. |
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
- Phase 3 dropped `python3` / `make` / `g++` from the image once `better-sqlite3` was gone (Playwright deps stay)

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

Vitest currently runs sequentially (`fileParallelism: false`). Isolation is one schema per worker; enabling file parallelism would spawn more workers each paying ~211 DDL statements. Reconsider after measuring.

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

## 6. Adapter simplification (done in Phase 4)

Kept:

- `Database` / `Transaction` async API
- `?` → `$n` conversion so application SQL did not have to switch to `$1` in the same change
- `getPostgresPool()` for the session store
- `__setTestDatabaseAdapter` for tests
- Cloud SQL unix-socket config for production

Removed:

- `SqliteAdapter`, `createSqliteDatabase`, `better-sqlite3`
- `SqliteSessionStore`
- `INSERT OR IGNORE` rewriting
- Blind `RETURNING id` + catch-and-retry. Callers that need the generated key include `RETURNING id`; `run()` copies `rows[0].id` to `lastID`

Boolean writes use native `true`/`false` for `BOOLEAN` columns. `queue_versions.dirty` and `events.spectator_results_released` remain integers.

---

## 7. Docs and agent instructions

Update together so the next agent does not recreate SQLite:

- `README.md` prerequisites: Docker + Compose; setup becomes `docker compose up -d` then `npm run dev`
- `AGENTS.md`: replace “mkdir database” / “SQLite locally” with Compose + `DATABASE_URL` / `TEST_DATABASE_URL`
- `.env.example`, `docs/API_TESTING.md` (`sqlite3 database/colosseum.db` → `psql`)
- `.gitignore`: local SQLite files are gone; do not reintroduce `database/*.db*`
- Serena memories: `server/core.md`, `conventions.md`, `task_completion.md`

Cursor Cloud agents need Docker Compose. Do not reintroduce SQLite as a Cloud-agent escape hatch; if Compose is unavailable, document that the environment cannot run DB-backed commands.

---

## 8. Phases

Each phase should be mergeable on its own.

### Phase 0 — Postgres available, SQLite still default (done)

- Add `docker-compose.yml`, init SQL for `colosseum_test`, `db:*` scripts, `.env.example` comments
- Wire the **devcontainer** to Compose + `DATABASE_URL` so Codespaces/devcontainers can opt in immediately
- Document “set `DATABASE_URL` to use local Postgres”
- **Do not** change the default yet — e2e still writes SQLite files

Mostly new files; almost no runtime risk. Setting `DATABASE_URL` today already selects `PostgresAdapter` + `initializePostgres` + `connect-pg-simple`.

### Phase 1 — Tests and local e2e on Postgres

Split in two so the Vitest half could merge on its own. SQLite stays the local default until Phase 2, so e2e keeps working untouched while 1a lands.

#### Phase 1a — Vitest and CI on Postgres (done)

- `createTestDb()` → schema per Vitest **worker process** on `colosseum_test`, truncated with `RESTART IDENTITY CASCADE` on each acquire. Schema-per-`createTestDb()` call was measured as impractical: 57 files call it from `beforeEach` across 1166 test cases, and one init is ~211 DDL statements over 32 tables. The suite runs in ~60s as built.
- `search_path` is pinned via the pool's `options` connection parameter, not a per-query `SET`, so a released connection cannot leak into `public` (where 1b's e2e will live).
- Each acquire returns a **fresh adapter** over the shared pool: `queueSync` keys its coalescing state on adapter object identity, so reuse leaked sync state between tests.
- sqlite-catalog assertions rewritten to `information_schema` / `pg_indexes`
- CI Postgres 18 service + `TEST_DATABASE_URL` (Vitest only)
- `postgresParity.test.ts` (regex over recorded SQL) replaced by `postgresSchema.test.ts`, which introspects the live schema
- Adapter tests against real Postgres (`postgresAdapter.test.ts`)

Type/constraint mismatches this surfaced, all fixed as production bugs:

- Routes classified constraint violations by SQLite message text, so on Postgres every violation returned 500 instead of 400/409. Now `src/server/database/constraintErrors.ts`.
- `PostgresAdapter.runInsert` appended `RETURNING id`, swallowed any error, and retried. Inside a transaction the failed probe aborts the transaction, so the retry reported "current transaction is aborted" and the real error was lost. Now falls back only on SQLSTATE 42703, uses a savepoint inside transactions, and memoizes id-less tables.
- `bracket_entries` inserts wrote integer literals into the boolean `is_bye` column, which Postgres rejects.
- `GET /scores/by-event/:eventId` returned `totalCount` as a string, because `COUNT(*)` is BIGINT.
- The `DO $$` FK guards in `scoring.ts` matched constraint names across all schemas, so they could silently skip adding a foreign key.

Known follow-up: `events.event_date` is a `DATE`, and `pg` parses it at **local** midnight, so the serialized value can land on the previous day when the server is not UTC. This is pre-existing production behaviour that the client tolerates via `toDateOnlyString`, so it was left alone; the test suite pins `TZ=UTC`.

#### Phase 1b — Local Playwright on Postgres (done)

- Playwright starts its own Express (3001) and Vite (5174) with `DATABASE_URL=$TEST_DATABASE_URL` and `reuseExistingServer: false`, so `npm run test:e2e` runs alongside `npm run dev` without touching the dev database
- `e2e/helpers/db.ts` wraps `createPostgresDatabase` over a `pg` pool rather than adding a second SQL translation layer. The `Database` interface already keeps `?` placeholders and reports `lastID`, so the spec SQL needed no rewriting and `runInsert`'s `RETURNING id` handling is exercised by the e2e path too.
- `e2e/helpers/session.ts` replaced four copies of the cookie-signing helper and five copies of the admin-session seeding block, and moved sessions from SQLite `sessions` (`expires` INTEGER ms) to the `connect-pg-simple` `"session"` table (`sess` JSON, `expire` TIMESTAMP, upserted with `ON CONFLICT`). A substring match on `sess` now needs an explicit `sess::text` cast.
- `SESSION_SECRET` for the e2e server is pinned to one constant shared by `playwright.config.ts` and the helper. The specs previously fell back to the `.env.example` default, so a developer with a real secret in `.env` got cookies the server rejected.
- `e2e/globalSetup.ts` truncates `public` once per run, so a crashed run cannot poison the next one. It refuses to run unless the resolved database name looks like a test database, since it truncates everything it finds. Playwright starts `webServer` before `globalSetup`, so the schema is already applied by then.
- `config/testDatabaseUrl.ts` shares `TEST_DATABASE_URL` resolution with `vitest.config.ts` so the two suites cannot drift onto different servers.
- `vite.config.ts` takes its proxy target from `COLOSSEUM_API_URL` instead of hardcoding `http://localhost:3000` in all 16 entries, and sets `strictPort`. Letting Vite drift to the next free port is what would allow the dev stack to land on 5174 and e2e to attach to it.
- The e2e server is pinned to `TZ=UTC` for the same reason as the Vitest suite: `pg` parses `events.event_date` at local midnight.

Dialect mismatches the conversion surfaced, all in test code:

- `is_admin`, `is_active`, and `is_bye` were written as `1`/`0` into boolean columns. `events.spectator_results_released` is genuinely `INTEGER` and still takes `0`/`1`.
- `spectator-public.spec.ts` carried a `try { ALTER TABLE ... }` loop plus a `CREATE TABLE IF NOT EXISTS ... AUTOINCREMENT` to patch up older dev SQLite files. Every column it added is in the Postgres schema, so the whole block went away.
- `datetime('now')` in `bracket-lifecycle.spec.ts` became `CURRENT_TIMESTAMP`.

`admin-tournament-setup.spec.ts` signed cookies with `cookie-signature`, an undeclared transitive dependency of `express-session`; it now uses the shared HMAC helper, which produces the same output.

Playwright is still **not** added to GitHub Actions.

### Phase 2 — Postgres is the only local default (done)

- `getDatabase()` / `initializeDatabase()` / `server.ts` session store: Postgres only
- Connection selection is lazy `resolvePostgresConfig()`: `DATABASE_URL` → URL; else `DB_HOST` → TCP; else `CLOUD_SQL_CONNECTION_NAME` → unix socket; otherwise throw. `NODE_ENV === 'production'` is not a dialect proxy
- `src/server/loadEnv.ts` is the first import in `server.ts` so `.env` is applied before connection code runs
- Fail fast with a Compose hint if the server is unreachable via `DATABASE_URL` (`ECONNREFUSED` / empty-message `AggregateError`)
- Remove SQLite session branch from the running app (`SqliteSessionStore` file stays until Phase 3)
- README / `AGENTS.md` / `.env.example` / Serena memories no longer document a SQLite local default
- Keep schema `sqlite:` blocks temporarily so a revert is still possible if needed

### Phase 3 — Delete the second dialect (done)

- Collapse schema modules: `SchemaModule` extends `DialectSchema` with `name`; `runSchema(db, schemaModules)` with no dialect argument
- Delete `SqliteAdapter`, `SqliteSessionStore`, `better-sqlite3`
- Slim the devcontainer image (`python3` / `make` / `g++`)
- `postgresParity.test.ts` was already replaced by `postgresSchema.test.ts` in Phase 1a
- `vitest.config.ts`: keep `fileParallelism: false` (isolation-safe but unmeasured; extra workers each pay ~211 DDL statements)

### Phase 4 — Reduce adapter magic (done)

- Explicit `RETURNING id` on INSERTs that read `lastID`; the adapter no longer probes, savepoints, or appends `RETURNING`
- Dropped the dead `INSERT OR IGNORE` rewrite
- Native boolean params in remaining tests (`is_bye` `true`/`false` rather than `1`/`0`)
- Coverage excludes for `connection.ts` / `init.ts` removed; `postgresAdapter.test.ts` and `init.test.ts` cover them
- Postgres-only constraint classification in `constraintErrors.ts`

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
| Session (server wiring) | `src/server/server.ts` |
| Vitest DB helper | `tests/sql/helpers/testDb.ts` |
| Shared test DB URL | `config/testDatabaseUrl.ts` |
| E2E harness | `e2e/globalSetup.ts`, `e2e/helpers/`, `playwright.config.ts` |
| Vite proxy (env-driven) | `vite.config.ts` |
| CI | `.github/workflows/ci.yml` |
| Devcontainer | `.devcontainer/devcontainer.json`, `.devcontainer/Dockerfile` |
| Prod image | `Dockerfile`, `cloudbuild.yaml` |
