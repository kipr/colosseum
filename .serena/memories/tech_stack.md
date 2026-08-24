# Technology stack

- Node/npm project; lockfile is `package-lock.json`. README minimum is Node 16+, while current typings are Node 24.
- TypeScript 5.9, strict throughout, target ES2020.
- Client: React 19, React DOM 19, React Router 7, Vite 7, React JSX transform. `tsconfig.client.json` uses ESNext/bundler resolution, no emit, isolated modules, and aliases `@/* -> src/client/*`, `@shared/* -> src/shared/*`.
- Server: Express 5, ts-node/nodemon in development, CommonJS output via `tsconfig.json`; build includes only `src/server` and `src/shared`.
- Persistence: `better-sqlite3` in development/tests; `pg` in production or whenever `DATABASE_URL` is set. A shared async database adapter normalizes SQL parameters/results across both.
- Auth/session: Passport Google OAuth, express-session, custom SQLite session store in development, connect-pg-simple in PostgreSQL deployments.
- Tests: Vitest 4 in Node environment; sequential/non-parallel execution is intentional for SQLite/native bindings. Playwright 1.58 runs Chromium browser E2E and starts both app servers.
- Quality/build: ESLint 9 flat config (TypeScript, React, CSS), Prettier 3.8 with single quotes, Vite client build, `tsc` server build.
- Deployment artifacts include Docker/Cloud Build configuration; PostgreSQL is production-oriented.