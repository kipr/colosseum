# Database Architecture

Colosseum uses PostgreSQL 18 in development, Vitest, Playwright, and production.
SQLite is not supported.

The authoritative schema is the ordered module list in
[`src/server/database/schema/index.ts`](../src/server/database/schema/index.ts).
Each module owns its tables, indexes, triggers, constraints, and additive column
updates. `initializeDatabase()` applies the schema at server or test startup.
Do not copy SQL from the documents in `docs/legacy/` into the application.

## Connections

- Local application: `DATABASE_URL`, normally
  `postgres://colosseum:colosseum@localhost:5432/colosseum`
- Vitest and Playwright: `TEST_DATABASE_URL`, normally
  `postgres://colosseum:colosseum@localhost:5432/colosseum_test`
- Production: either `DATABASE_URL`, or `DB_HOST`/`DB_USER`/`DB_PASSWORD`/
  `DB_NAME`; Cloud SQL may use `CLOUD_SQL_CONNECTION_NAME`

Start local PostgreSQL before any database-backed command:

```bash
npm run db:up && npm run db:wait
```

Use `npm run db:psql` for an interactive shell. `npm run db:reset` destroys the
local Compose volume and recreates both local databases, so use it only when the
data can be discarded.

## Schema modules and tables

| Module           | Tables                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `users`          | `users`                                                                                                                            |
| `scoresheets`    | `scoresheet_field_templates`, `scoresheet_templates`                                                                               |
| `events`         | `events`, `teams`                                                                                                                  |
| `seeding`        | `seeding_scores`, `seeding_rankings`                                                                                               |
| `documentation`  | `documentation_categories`, `event_documentation_categories`, `documentation_scores`, `documentation_sub_scores`                   |
| `scoring`        | `score_submissions`, `score_details`, `event_scoresheet_templates`                                                                 |
| `brackets`       | `brackets`, `bracket_entries`, `bracket_games`, `bracket_templates`                                                                |
| `double-seeding` | `double_seeding_matches`, `double_seeding_scores`, `double_seeding_rankings`                                                       |
| `queue`          | `game_queue`, `queue_versions`                                                                                                     |
| `sessions`       | `active_sessions`, `session`                                                                                                       |
| `audit`          | `audit_log`                                                                                                                        |
| `awards`         | `award_templates`, `event_awards`, `event_award_recipients`, `event_award_individual_recipients`, `event_automatic_award_settings` |
| `judge-chat`     | `judge_chat_messages`                                                                                                              |

The `session` table is the `connect-pg-simple` web-session store. The remaining
tables are application-owned.

## Schema changes

For a new table, index, constraint, or trigger, update the owning schema module.
For a column that must also be added to existing databases, add it to the
module's `columns` list as well as its `CREATE TABLE` statement. The runner
checks `information_schema.columns` in the current schema before applying an
additive column change.

Schema initialization runs in a transaction and processes phases in this order:

1. tables
2. additive columns
3. constraints
4. shared `updated_at` triggers
5. module-specific triggers
6. indexes

Vitest gives each worker an isolated PostgreSQL schema and truncates it between
tests. Playwright uses the `public` schema of `colosseum_test` and truncates it
once at global setup. Neither test suite uses the local `colosseum` database.
