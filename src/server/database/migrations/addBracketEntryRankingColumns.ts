import { Database } from '../connection';
import { Dialect } from '../dialect';
import { Migration } from './types';

/**
 * Postgres-only: backfill ranking columns on `bracket_entries`
 * (`final_rank`, `bracket_raw_score`, `weighted_bracket_raw_score`) on
 * databases that predate them.
 */
export const addBracketEntryRankingColumns: Migration = {
  name: 'addBracketEntryRankingColumns',
  async run(db: Database, dialect: Dialect): Promise<void> {
    if (dialect !== 'postgres') return;
    try {
      await db.exec(
        `ALTER TABLE bracket_entries ADD COLUMN IF NOT EXISTS final_rank INTEGER`,
      );
      await db.exec(
        `ALTER TABLE bracket_entries ADD COLUMN IF NOT EXISTS bracket_raw_score REAL`,
      );
      await db.exec(
        `ALTER TABLE bracket_entries ADD COLUMN IF NOT EXISTS weighted_bracket_raw_score REAL`,
      );
    } catch {
      // Columns might already exist
    }
  },
};
