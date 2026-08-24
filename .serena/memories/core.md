# Colosseum core

- Tournament management/scoring platform: event setup, teams, seeding and double-seeding, double-elimination brackets, judge queue, schema-driven scoresheets, score review/audit, awards, judge chat, and public spectator views.
- Source map: `src/client` React SPA; `src/server` Express API/persistence; `src/shared` cross-runtime scoring/schema types and validation; `templates` example scoresheet JSON; `tests` Vitest unit/integration/HTTP/SQL tests; `e2e` Playwright browser tests; `tools/portable-scoresheet` standalone scoresheet exporter.
- Event-centric invariant: most operational entities and API reads/writes are scoped by event ID. Preserve event isolation in routes, queries, scoring, rankings, queues, brackets, documentation, and awards.
- Judges use access-code/session flows without Google OAuth; admin flows use Google OAuth and default to `@kipr.org` accounts unless `ALLOWED_EMAIL_DOMAINS=` permits all domains.
- Scoresheet behavior is schema-driven; shared types/validation in `src/shared/scoresheetSchema.ts` are the contract for client, server, templates, and tests. Repeatable-group fields are not supported by the portable exporter.
- Production builds the client to `dist/client` and CommonJS server output to `dist/server`; Express serves the built SPA. Development uses Vite on 5173 proxying API routes to Express on 3000.
- Read `mem:client/core` for SPA structure and frontend invariants.
- Read `mem:server/core` for API, database, auth/session, and backend structure.
- Read `mem:tech_stack` for pinned technologies and compiler/build boundaries.
- Read `mem:conventions` before implementation for code and test conventions.
- Read `mem:suggested_commands` for setup and day-to-day commands.
- Read `mem:task_completion` before handing off a coding change.