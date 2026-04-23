import { Database } from '../connection';
import { Dialect } from '../dialect';
import { Migration } from './types';

/**
 * Postgres-only: backfill `events.score_accept_mode` on databases that
 * predate the column.
 */
export const addEventScoreAcceptMode: Migration = {
  name: 'addEventScoreAcceptMode',
  async run(db: Database, dialect: Dialect): Promise<void> {
    if (dialect !== 'postgres') return;
    try {
      await db.exec(
        `ALTER TABLE events ADD COLUMN IF NOT EXISTS score_accept_mode TEXT NOT NULL DEFAULT 'manual'`,
      );
    } catch {
      // Column might already exist
    }
  },
};
