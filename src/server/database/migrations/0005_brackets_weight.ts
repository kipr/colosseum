import type { Migration } from './runner';

const migration: Migration = {
  id: '0005_brackets_weight',
  name: 'Add brackets.weight column',
  up: async (db, dialect) => {
    if (dialect !== 'pg') return;
    await db.exec(
      `ALTER TABLE brackets ADD COLUMN IF NOT EXISTS weight REAL NOT NULL DEFAULT 1.0`,
    );
  },
};

export default migration;
