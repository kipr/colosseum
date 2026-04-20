import type { Migration } from './runner';

/**
 * Add the deferred FK from `score_submissions.game_queue_id` to
 * `game_queue(id)` once both tables exist. Postgres only -- on SQLite, the
 * baseline declares this FK inline (SQLite resolves forward references
 * lazily).
 */
const migration: Migration = {
  id: '0009_score_submissions_game_queue_fk',
  name: 'Add score_submissions -> game_queue FK',
  up: async (db, dialect) => {
    if (dialect !== 'pg') return;
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
  },
};

export default migration;
