import type { Migration } from './runner';

const migration: Migration = {
  id: '0003_events_spectator_results_released',
  name: 'Add events.spectator_results_released column',
  up: async (db, dialect) => {
    if (dialect !== 'pg') return;
    await db.exec(
      `ALTER TABLE events ADD COLUMN IF NOT EXISTS spectator_results_released INTEGER NOT NULL DEFAULT 0`,
    );
  },
};

export default migration;
