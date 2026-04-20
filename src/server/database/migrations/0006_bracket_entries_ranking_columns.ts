import type { Migration } from './runner';

const migration: Migration = {
  id: '0006_bracket_entries_ranking_columns',
  name: 'Add bracket_entries ranking columns',
  up: async (db, dialect) => {
    if (dialect !== 'pg') return;
    await db.exec(
      `ALTER TABLE bracket_entries ADD COLUMN IF NOT EXISTS final_rank INTEGER`,
    );
    await db.exec(
      `ALTER TABLE bracket_entries ADD COLUMN IF NOT EXISTS bracket_raw_score REAL`,
    );
    await db.exec(
      `ALTER TABLE bracket_entries ADD COLUMN IF NOT EXISTS weighted_bracket_raw_score REAL`,
    );
  },
};

export default migration;
