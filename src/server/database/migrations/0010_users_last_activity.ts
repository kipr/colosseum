import type { Migration } from './runner';

const migration: Migration = {
  id: '0010_users_last_activity',
  name: 'Add users.last_activity column',
  up: async (db, dialect) => {
    if (dialect !== 'pg') return;
    await db.exec(
      `ALTER TABLE users ADD COLUMN IF NOT EXISTS last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP`,
    );
  },
};

export default migration;
