/**
 * Normalize stored scoresheet templates to the canonical schema.
 *
 * Usage:
 *   npm run migrate:scoresheets -- --sqlite /path/to/dump.db
 *   npm run migrate:scoresheets -- --database-url "$DATABASE_URL" --apply
 */
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

import { runMigrateCli } from '../src/server/scoresheetAudit/migrateCli';

async function main(): Promise<void> {
  const code = await runMigrateCli(process.argv.slice(2));
  process.exit(code);
}

void main();
