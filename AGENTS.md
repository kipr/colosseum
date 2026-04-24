# Colosseum - Agent Instructions

## Cursor Cloud specific instructions

### Project overview

Colosseum is a tournament management and scoring platform (React 19 + Express 5 + TypeScript). See `README.md` for full details.

### Source layout

- `src/client/` — React 19 frontend (Vite). Built with `tsconfig.client.json`.
- `src/server/` — Express 5 backend. Built with `tsconfig.json`.
- `src/shared/` — **Shared definitions used by both client and server.** Both `tsconfig.json` and `tsconfig.client.json` `include` this directory, so types defined here compile into both bundles without extra config.
  - `src/shared/domain/` — Canonical entity-level enums, DTOs, label maps, and validators (e.g. `EventStatus`, `QueueStatus`, `BracketStatus`, `ScoreSubmissionStatus`, `Bracket`, `BracketGame`, plus `sqlEnumCheck` helpers used by the DB schema). Imported via `from '<relative>/shared/domain'`.
  - `src/shared/api/` — HTTP response DTOs (the wire shapes returned by specific Express routes, consumed by client fetchers). See `src/shared/api/README.md` for the full conventions, what is currently shared, and the migration backlog.

When adding or modifying code that crosses the client/server boundary:

1. Type status fields with the matching domain enum from `src/shared/domain/`, never `string`.
2. If the server emits a new response shape (or you spot drift between a client `interface` and a server handler), add the DTO to `src/shared/api/` instead of redeclaring it on the client. Reuse domain entities/enums where possible.
3. DB CHECK constraints for enum columns should be derived from the shared enum arrays via `sqlEnumCheck` (`src/shared/domain/sql.ts`), so the schema stays in lockstep with TypeScript.
4. Prefer `readonly` arrays/properties on shared DTOs — decoded responses are snapshots.

### Services

| Service                    | Port        | Command              |
| -------------------------- | ----------- | -------------------- |
| Express API (backend)      | 3000        | `npm run dev:server` |
| Vite dev server (frontend) | 5173        | `npm run dev:client` |
| Both together              | 3000 + 5173 | `npm run dev`        |

### Key caveats

- The `database/` directory must exist before the Express server starts. Run `mkdir -p database` if it doesn't exist. SQLite DB files are auto-created inside it.
- `npm run dev` uses `concurrently`; the Vite client waits for the Express health endpoint to become available before starting. If port 5173 is already in use, Vite will pick the next available port (e.g. 5174).
- Google OAuth (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`) is only needed for admin login. Judge-facing features (score submission via access codes) and public/spectator views work without OAuth. Tests use auth shims and do not require real credentials.
- By default, only `@kipr.org` email addresses can log in as admin. To allow all domains, set `ALLOWED_EMAIL_DOMAINS=` (empty string) in `.env`.
- The dev database is SQLite (via `better-sqlite3`); PostgreSQL is production-only. Tests use in-memory SQLite.
- Copy `.env.example` to `.env` before starting the server: `cp .env.example .env`.
- The OAuth callback URL is derived from `APP_URL` (see `src/server/config/google.ts`). After login, users are redirected to the Vite dev server with `?logged_in=1`.

### Standard commands (see `package.json`)

- **Lint**: `npm run lint` (ESLint) and `npm run pretty` (Prettier check)
- **Test**: `npm run test:run` (all tests, single run) or `npm test` (watch mode)
- **Build**: `npm run build` (cleans, then builds client + server)
- **Dev**: `npm run dev` (starts both servers concurrently)
- **Verify all**: `npm run pretty && npm run lint && npm run test:run && npm run build`
