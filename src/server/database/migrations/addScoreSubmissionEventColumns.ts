import { Database } from '../connection';
import { Dialect } from '../dialect';
import { Migration } from './types';

/**
 * Postgres-only: backfill event-scoped columns on `score_submissions`
 * (`event_id`, `bracket_game_id`, `seeding_score_id`, `score_type`,
 * `game_queue_id`) on databases that predate them.
 *
 * `bracket_game_id` and `game_queue_id` get their FK constraints attached by
 * `addScoreSubmissionsBracketGameFk` and `addScoreSubmissionsGameQueueFk`
 * after the referenced tables exist.
 */
export const addScoreSubmissionEventColumns: Migration = {
  name: 'addScoreSubmissionEventColumns',
  async run(db: Database, dialect: Dialect): Promise<void> {
    if (dialect !== 'postgres') return;
    try {
      await db.exec(
        `ALTER TABLE score_submissions ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id) ON DELETE SET NULL`,
      );
      await db.exec(
        `ALTER TABLE score_submissions ADD COLUMN IF NOT EXISTS bracket_game_id INTEGER`,
      );
      await db.exec(
        `ALTER TABLE score_submissions ADD COLUMN IF NOT EXISTS seeding_score_id INTEGER REFERENCES seeding_scores(id) ON DELETE SET NULL`,
      );
      await db.exec(
        `ALTER TABLE score_submissions ADD COLUMN IF NOT EXISTS score_type TEXT`,
      );
      await db.exec(
        `ALTER TABLE score_submissions ADD COLUMN IF NOT EXISTS game_queue_id INTEGER`,
      );
    } catch {
      // Columns might already exist
    }
  },
};
