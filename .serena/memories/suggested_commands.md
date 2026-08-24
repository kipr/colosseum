# Suggested commands

## First setup
- `npm install`
- `cp .env.example .env`
- `mkdir -p database` — required before Express opens SQLite/session databases.
- Admin login additionally needs Google OAuth values; judge and public workflows do not.

## Development and production
- `npm run dev` — Express on 3000 plus Vite on 5173; Vite waits for `/health` and may choose 5174+ if occupied.
- `npm run dev:server` — Express with nodemon.
- `npm run dev:client` — waits for Express health, then starts Vite.
- `npm run build && npm start` — production build and server.
- `npm run preview` — preview the Vite build.
- `npm run export:scoresheet` — generate portable scoresheet output.

## Checks
- `npm run test:run` — all Vitest tests once.
- `npm test` — Vitest watch mode.
- `npm run coverage`
- `npm run test:e2e` — Playwright; its config starts backend and frontend.
- `npm run typecheck:client`
- `npm run typecheck:server`
- `npm run lint`
- `npm run pretty`
- `npm run build`
- Target a test with `npx vitest run path/to/file.test.ts`; target E2E with `npx playwright test path/to/spec.ts`.