import type { TableDefinition } from './types';

/**
 * Session store table for `connect-pg-simple`. Postgres-only; on SQLite the
 * baseline emits no DDL because SQLite never serves production sessions.
 *
 * The `pg` body also creates the partner index (the standard pg-simple
 * setup script bundles them together).
 */
export const sessionTable: TableDefinition = {
  name: 'session',
  pg: `
    CREATE TABLE IF NOT EXISTS "session" (
      "sid" VARCHAR NOT NULL COLLATE "default",
      "sess" JSON NOT NULL,
      "expire" TIMESTAMP(6) NOT NULL,
      CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
    );
    CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
  `,
  sqlite: '',
};
