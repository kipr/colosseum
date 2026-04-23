import { Database } from '../connection';
import { Dialect } from '../dialect';
import { Migration } from './types';

/**
 * Postgres-only: backfill `spreadsheet_configs.auto_accept` on databases
 * that predate the column.
 */
export const addSpreadsheetAutoAccept: Migration = {
  name: 'addSpreadsheetAutoAccept',
  async run(db: Database, dialect: Dialect): Promise<void> {
    if (dialect !== 'postgres') return;
    try {
      await db.exec(
        `ALTER TABLE spreadsheet_configs ADD COLUMN IF NOT EXISTS auto_accept BOOLEAN DEFAULT FALSE`,
      );
    } catch {
      // Column might already exist
    }
  },
};
