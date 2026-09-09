# Task completion

- Run the narrowest relevant Vitest file(s) during implementation: `npx vitest run path/to/file.test.ts`.
- For frontend changes, run `npm run typecheck:client`; for server/shared changes, run `npm run typecheck:server`. The full build also exercises both compilation paths.
- Repository-standard full verification before handoff:
  `npm run pretty && npm run lint && npm run test:run && npm run build`
- Run `npm run test:e2e` when behavior changes a user journey, routing/proxying, authentication/access-code flow, or integration across client and server. It is not part of the standard full-verification chain.
- Database/schema/query changes run against PostgreSQL (`npm run db:up && npm run db:wait` first). Use `tests/sql`, `tests/server/database/postgresSchema.test.ts`, and relevant HTTP/service tests. Do not reintroduce a SQLite default for the app.
- Before reporting completion, inspect `git diff`/status, preserve unrelated user changes, and state which checks were run and any not run.
