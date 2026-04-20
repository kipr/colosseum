import type { Migration } from './runner';

const migration: Migration = {
  id: '0002_events_score_accept_mode',
  name: 'Add events.score_accept_mode column',
  up: async (db, dialect) => {
    if (dialect !== 'pg') return;
    await db.exec(
      `ALTER TABLE events ADD COLUMN IF NOT EXISTS score_accept_mode TEXT NOT NULL DEFAULT 'manual'`,
    );
  },
};

export default migration;
