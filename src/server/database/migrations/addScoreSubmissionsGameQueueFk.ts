import { Database } from '../connection';
import { Dialect } from '../dialect';
import { Migration } from './types';

/**
 * Postgres-only: add the deferred FK from `score_submissions.game_queue_id`
 * to `game_queue(id)`. `game_queue` is created after `score_submissions`,
 * so the constraint cannot be inlined.
 *
 * SQLite declares the FK inline on `CREATE TABLE` (forward refs are
 * allowed); this migration is a no-op there.
 */
export const addScoreSubmissionsGameQueueFk: Migration = {
  name: 'addScoreSubmissionsGameQueueFk',
  async run(db: Database, dialect: Dialect): Promise<void> {
    if (dialect !== 'postgres') return;
    try {
      await db.exec(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'score_submissions_game_queue_id_fkey'
              AND table_name = 'score_submissions'
          ) THEN
            ALTER TABLE score_submissions
              ADD CONSTRAINT score_submissions_game_queue_id_fkey
              FOREIGN KEY (game_queue_id) REFERENCES game_queue(id) ON DELETE SET NULL;
          END IF;
        END $$
      `);
    } catch {
      // FK might already exist
    }
  },
};
