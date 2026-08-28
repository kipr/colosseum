import dotenv from 'dotenv';
dotenv.config();

import { closeDatabase, getDatabase } from '../database/connection';
import {
  checkScoresheetKindMigration,
  formatScoresheetKindCheckLine,
} from '../database/migrations/scoresheetKind';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (!args.includes('--check')) {
    console.error('Usage: npm run migrate:scoresheet-kind -- --check');
    process.exitCode = 2;
    return;
  }

  const db = await getDatabase();
  try {
    const report = await checkScoresheetKindMigration(db);
    for (const row of report.templates) {
      console.log(formatScoresheetKindCheckLine(row));
    }
    console.log(
      `checked ${report.templates.length} template(s): ${report.changedCount} to migrate, ${report.unchangedCount} unchanged, ${report.errorCount} blocker(s)`,
    );
    if (report.errorCount > 0) {
      process.exitCode = 1;
    }
  } finally {
    await closeDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
