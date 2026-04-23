import { Database } from '../connection';
import { Dialect } from '../dialect';
import { Migration } from './types';

/**
 * Postgres-only: backfill `users.last_activity` on databases that predate the
 * column. Fresh databases already have it from CREATE TABLE; SQLite includes
 * it inline.
 */
export const addUserLastActivity: Migration = {
  name: 'addUserLastActivity',
  async run(db: Database, dialect: Dialect): Promise<void> {
    if (dialect !== 'postgres') return;
    try {
      await db.exec(
        `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
      );
    } catch {
      // Column might already exist or syntax not supported
    }
  },
};
