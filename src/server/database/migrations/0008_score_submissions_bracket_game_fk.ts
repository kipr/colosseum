import type { Migration } from './runner';

/**
 * Add the deferred FK from `score_submissions.bracket_game_id` to
 * `bracket_games(id)` once both tables exist. Postgres only -- on SQLite,
 * the baseline declares this FK inline (SQLite resolves forward FK
 * references lazily).
 */
const migration: Migration = {
  id: '0008_score_submissions_bracket_game_fk',
  name: 'Add score_submissions -> bracket_games FK',
  up: async (db, dialect) => {
    if (dialect !== 'pg') return;
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
  },
};

export default migration;
