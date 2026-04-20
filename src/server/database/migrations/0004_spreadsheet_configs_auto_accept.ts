import type { Migration } from './runner';

const migration: Migration = {
  id: '0004_spreadsheet_configs_auto_accept',
  name: 'Add spreadsheet_configs.auto_accept column',
  up: async (db, dialect) => {
    if (dialect !== 'pg') return;
    await db.exec(
      `ALTER TABLE spreadsheet_configs ADD COLUMN IF NOT EXISTS auto_accept BOOLEAN DEFAULT FALSE`,
    );
  },
};

export default migration;
