import type { Migration } from './runner';

const migration: Migration = {
  id: '0007_score_submissions_event_scoped_columns',
  name: 'Add score_submissions event-scoped columns',
  up: async (db, dialect) => {
    if (dialect !== 'pg') return;
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
  },
};

export default migration;
