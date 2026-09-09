# Server module

- `src/server/server.ts` imports `loadEnv` first (so `.env` is applied before connection code), exposes DB-free `GET /health`, configures CORS/body parsing/session/Passport, mounts routers, serves static assets/build output, initializes the database, and owns graceful shutdown.
- Router prefixes: `/auth`, `/api/admin`, `/scoresheet`, `/field-templates`, `/api`, `/scores`, `/chat`, `/events`, `/teams`, `/seeding`, `/double-seeding`, `/brackets`, `/queue`, `/audit`, `/documentation-scores`, `/awards`.
- Keep route handlers focused on HTTP validation/auth/response shaping; place ranking, bracket, queue, score acceptance, formula, diagnostics, and award logic in `services`.
- Persistence is PostgreSQL only. `resolvePostgresConfig()` reads env at call time: `DATABASE_URL` → TCP pool; else `CLOUD_SQL_CONNECTION_NAME` → unix socket; otherwise throw with a `db:up` hint. `NODE_ENV` is not a dialect signal. Use only the async adapter from `database/connection.ts`; do not couple feature code to a driver.
- Schema initialization always runs the Postgres path. Each schema module is a name plus one `DialectSchema`; register modules in `database/schema/index.ts`. Ordering matters for foreign keys/dependencies. Additive columns use `information_schema.columns` scoped to `current_schema()`.
- Session store is `connect-pg-simple` on table `"session"`. Production cookies are secure and proxy-aware (`NODE_ENV === 'production'` still controls `trust proxy` / `cookie.secure` / static serving).
- Admin endpoints use Passport sessions; judge-facing scoring/chat use judge authorization/access-code state; public endpoints are explicitly separate. Do not weaken these boundaries.
- Core state transitions (score acceptance/revert, bracket winner advancement/byes, rankings, queue synchronization/versioning, audit records) span tables and should remain atomic and idempotent where existing behavior expects it.
- See `mem:core` for project-wide invariants, `mem:conventions` for DB/test conventions, and `mem:task_completion` for backend verification.
