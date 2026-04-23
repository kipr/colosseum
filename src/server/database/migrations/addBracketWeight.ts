import { Database } from '../connection';
import { Dialect } from '../dialect';
import { Migration } from './types';

/**
 * Postgres-only: backfill `brackets.weight` on databases that predate the
 * column.
 */
export const addBracketWeight: Migration = {
  name: 'addBracketWeight',
  async run(db: Database, dialect: Dialect): Promise<void> {
    if (dialect !== 'postgres') return;
    try {
      await db.exec(
        `ALTER TABLE brackets ADD COLUMN IF NOT EXISTS weight REAL NOT NULL DEFAULT 1.0`,
      );
    } catch {
      // Column might already exist
    }
  },
};
