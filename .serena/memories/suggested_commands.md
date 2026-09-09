# Suggested commands

## First setup
- `npm install`
- `cp .env.example .env`
- `npm run db:up && npm run db:wait` — required before Express, Vitest, or Playwright. Compose is mandatory; there is no SQLite fallback.
- Admin login additionally needs Google OAuth values; judge and public workflows do not.

## App and production
- `npm run dev` — Express on 3000 plus Vite on 5173; Vite waits for `/health`. Requires `DATABASE_URL` and a running Postgres. Fails fast with a `db:up` hint if the database is missing or unreachable.
- `npm run dev:server` — Express with nodemon.
- `npm run dev:client` — waits for Express health, then starts Vite.
- `npm run build && npm start` — production build and server (Cloud SQL env vars, not a SQLite file).
- `npm run preview` — preview the Vite build.
- `npm run export:scoresheet` — generate portable scoresheet output.

## Checks
- `npm run test:run` — all Vitest tests once (needs `TEST_DATABASE_URL` / Compose).
- `npm test` — Vitest watch mode.
- `npm run coverage`
- `npm run test:e2e` — Playwright; its config starts backend and frontend against `colosseum_test`.
- `npm run typecheck:client`
- `npm run typecheck:server`
- `npm run lint`
- `npm run pretty`
- `npm run build`
- Target a test with `npx vitest run path/to/file.test.ts`; target E2E with `npx playwright test path/to/spec.ts`.
