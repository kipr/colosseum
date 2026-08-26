/**
 * Read-only scoresheet template audit CLI.
 *
 * Usage:
 *   npm run audit:scoresheets -- --sqlite /path/to/dump.db
 *   npm run audit:scoresheets -- --database-url "$DATABASE_URL"
 *   npm run audit:scoresheets -- --fixtures templates
 */
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

import { runAuditCli } from '../src/server/scoresheetAudit/cli';

async function main(): Promise<void> {
  const code = await runAuditCli(process.argv.slice(2));
  process.exit(code);
}

void main();
