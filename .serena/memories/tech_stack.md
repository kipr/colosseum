# Technology stack

- Node/npm project; lockfile is `package-lock.json`. README minimum is Node 16+, while current typings are Node 24.
- TypeScript 5.9, strict throughout, target ES2020.
- Client: React 19, React DOM 19, React Router 7, Vite 7, React JSX transform. `tsconfig.client.json` uses ESNext/bundler resolution, no emit, isolated modules, and aliases `@/* -> src/client/*`, `@shared/* -> src/shared/*`.
- Server: Express 5, ts-node/nodemon locally, CommonJS/Node output via `tsconfig.json`; build includes only `src/server` and `src/shared`.
- Persistence: `pg` against PostgreSQL 18. Local app and tests require Docker Compose (`DATABASE_URL` / `TEST_DATABASE_URL`). Production Cloud Run uses `CLOUD_SQL_CONNECTION_NAME` plus `DB_USER` / `DB_PASSWORD` / `DB_NAME`. A shared async database adapter still normalizes SQL parameters; `better-sqlite3` remains only for leftover adapter unit tests until Phase 3.
- Auth/session: Passport Google OAuth, express-session, connect-pg-simple on table `"session"`.
- Tests: Vitest 4 in Node environment against `colosseum_test` (schema per worker). Sequential/non-parallel for now. Playwright 1.58 runs Chromium browser E2E against the same test database on ports 3001/5174.
- Quality/build: ESLint 9 flat config (TypeScript, React, CSS), Prettier 3.8 with single quotes, Vite client build, `tsc` server build.
- Deployment artifacts include Docker/Cloud Build configuration.
