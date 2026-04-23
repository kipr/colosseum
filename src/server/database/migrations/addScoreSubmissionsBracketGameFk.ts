import { Database } from '../connection';
import { Dialect } from '../dialect';
import { Migration } from './types';

/**
 * Postgres-only: add the deferred FK from `score_submissions.bracket_game_id`
 * to `bracket_games(id)`. The FK can't be inlined on `CREATE TABLE` because
 * `score_submissions` is created before `bracket_games` (they form a circular
 * relationship via `bracket_games.score_submission_id`).
 *
 * SQLite tolerates forward FK references on `CREATE TABLE`, so the constraint
 * is declared inline there and this migration is a no-op.
 */
export const addScoreSubmissionsBracketGameFk: Migration = {
  name: 'addScoreSubmissionsBracketGameFk',
  async run(db: Database, dialect: Dialect): Promise<void> {
    if (dialect !== 'postgres') return;
    try {
      await db.exec(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_name = 'score_submissions_bracket_game_id_fkey'
              AND table_name = 'score_submissions'
          ) THEN
            ALTER TABLE score_submissions
              ADD CONSTRAINT score_submissions_bracket_game_id_fkey
              FOREIGN KEY (bracket_game_id) REFERENCES bracket_games(id) ON DELETE SET NULL;
          END IF;
        END $$
      `);
    } catch {
      // FK might already exist
    }
  },
};
