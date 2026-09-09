# Colosseum - Agent Instructions

## Cursor Cloud specific instructions

### Project overview

Colosseum is a tournament management and scoring platform (React 19 + Express 5 + TypeScript). See `README.md` for full details.

### Services

| Service | Port | Command |
|---------|------|---------|
| Express API (backend) | 3000 | `npm run dev:server` |
| Vite dev server (frontend) | 5173 | `npm run dev:client` |
| Both together | 3000 + 5173 | `npm run dev` |
| Playwright e2e stack | 3001 + 5174 | `npm run test:e2e` |

### Key caveats

- The `database/` directory must exist before the Express server starts. Run `mkdir -p database` if it doesn't exist. SQLite DB files are auto-created inside it.
- `npm run dev` uses `concurrently`; the Vite client waits for the Express health endpoint to become available before starting. Vite runs with `strictPort`, so a taken port is an error rather than a silent move to the next one — that keeps the dev stack from landing on the e2e suite's port.
- Google OAuth (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) is only needed for admin login. Judge-facing features (score submission via access codes) and public/spectator views work without OAuth. Tests use auth shims and do not require real credentials.
- By default, only `@kipr.org` email addresses can log in as admin. To allow all domains, set `ALLOWED_EMAIL_DOMAINS=` (empty string) in `.env`.
- The dev database is SQLite (via `better-sqlite3`) unless `DATABASE_URL` is set; PostgreSQL is used in production and whenever `DATABASE_URL` is set.
- **The Vitest suite requires PostgreSQL.** Start it with `npm run db:up && npm run db:wait`, which also creates the `colosseum_test` database. Tests read `TEST_DATABASE_URL` (from the environment or `.env`), defaulting to `postgres://colosseum:colosseum@localhost:5432/colosseum_test`. Each worker process gets its own schema, truncated between tests. `npm run test:run` fails fast with a `db:up` hint if the server is unreachable.
- **The Playwright suite also requires PostgreSQL.** `npm run test:e2e` starts its own Express (3001) and Vite (5174) with `DATABASE_URL` set to `TEST_DATABASE_URL`, and never reuses a server on 3000/5173, so it can run while `npm run dev` is up. It uses the `public` schema of `colosseum_test` and truncates it once at the start of each run; the Vitest suite's per-worker schemas on the same database are unaffected. The specs seed data with `pg` through `e2e/helpers/db.ts` and log admins in by writing the `"session"` table via `e2e/helpers/session.ts`.
- Copy `.env.example` to `.env` before starting the server: `cp .env.example .env`.
- The OAuth callback URL is derived from `APP_URL` (see `src/server/config/google.ts`). After login, users are redirected to the Vite dev server with `?logged_in=1`.

### Standard commands (see `package.json`)

- **Lint**: `npm run lint` (ESLint) and `npm run pretty` (Prettier check)
- **Test**: `npm run test:run` (all tests, single run) or `npm test` (watch mode)
- **Build**: `npm run build` (cleans, then builds client + server)
- **Dev**: `npm run dev` (starts both servers concurrently)
- **Verify all**: `npm run pretty && npm run lint && npm run test:run && npm run build`
