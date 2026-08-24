# Server module

- `src/server/server.ts` loads dotenv before other app imports, exposes DB-free `GET /health`, configures CORS/body parsing/session/Passport, mounts routers, serves static assets/build output, initializes the database, and owns graceful shutdown.
- Router prefixes: `/auth`, `/api/admin`, `/scoresheet`, `/field-templates`, `/api`, `/scores`, `/chat`, `/events`, `/teams`, `/seeding`, `/double-seeding`, `/brackets`, `/queue`, `/audit`, `/documentation-scores`, `/awards`.
- Keep route handlers focused on HTTP validation/auth/response shaping; place ranking, bracket, queue, score acceptance, formula, diagnostics, and award logic in `services`.
- Persistence selects PostgreSQL when production or `DATABASE_URL` is present; otherwise SQLite files live under `database/`. Use only the async adapter from `database/connection.ts`; do not couple feature code to a driver.
- Schema initialization is split into ordered modules registered in `database/schema/index.ts`. Ordering matters for foreign keys/dependencies.
- Session stores differ by database: connect-pg-simple for PostgreSQL, custom better-sqlite3 store for development. Production cookies are secure and proxy-aware.
- Admin endpoints use Passport sessions; judge-facing scoring/chat use judge authorization/access-code state; public endpoints are explicitly separate. Do not weaken these boundaries.
- Core state transitions (score acceptance/revert, bracket winner advancement/byes, rankings, queue synchronization/versioning, audit records) span tables and should remain atomic and idempotent where existing behavior expects it.
- See `mem:core` for project-wide invariants, `mem:conventions` for DB/test conventions, and `mem:task_completion` for backend verification.