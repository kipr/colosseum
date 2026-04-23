import { Database } from '../connection';
import { Dialect } from '../dialect';
import { Migration } from './types';

/**
 * Postgres-only: backfill `events.spectator_results_released` on databases
 * that predate the column.
 */
export const addEventSpectatorResultsReleased: Migration = {
  name: 'addEventSpectatorResultsReleased',
  async run(db: Database, dialect: Dialect): Promise<void> {
    if (dialect !== 'postgres') return;
    try {
      await db.exec(
        `ALTER TABLE events ADD COLUMN IF NOT EXISTS spectator_results_released INTEGER NOT NULL DEFAULT 0`,
      );
    } catch {
      // Column might already exist
    }
  },
};
