# Task completion

- Run the narrowest relevant Vitest file(s) during implementation: `npx vitest run path/to/file.test.ts`.
- For frontend changes, run `npm run typecheck:client`; for server/shared changes, run `npm run typecheck:server`. The full build also exercises both compilation paths.
- Repository-standard full verification before handoff:
  `npm run pretty && npm run lint && npm run test:run && npm run build`
- Run `npm run test:e2e` when behavior changes a user journey, routing/proxying, authentication/access-code flow, or integration across client and server. It is not part of the standard full-verification chain.
- Database/schema/query changes must cover SQLite and consider PostgreSQL parity; use existing `tests/sql`, `tests/server/database/postgresParity.test.ts`, and relevant HTTP/service tests.
- Before reporting completion, inspect `git diff`/status, preserve unrelated user changes, and state which checks were run and any not run.