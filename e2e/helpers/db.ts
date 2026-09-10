/**
 * Database access for the Playwright suite.
 *
 * The specs talk to the same PostgreSQL database as the e2e Express server
 * (`colosseum_test`, `public` schema) through the production adapter, so there
 * is no second SQL translation layer to keep in sync. The adapter keeps `?`
 * placeholders and reports `lastID` for inserts, which is what the specs need.
 *
 * The Vitest suite uses ephemeral `colosseum_test_*` schemas on the same
 * database, so the two suites cannot see each other's rows.
 */
import { Pool } from 'pg';
import {
  createPostgresDatabase,
  Database,
} from '../../src/server/database/connection';
import { resolveTestDatabaseUrl } from '../../config/testDatabaseUrl';

let pool: Pool | null = null;
let db: Database | null = null;

/**
 * The shared database handle for this Playwright worker process.
 *
 * Lazily created, so `closeE2eDb()` in an `afterAll` does not stop a later
 * spec in the same worker from connecting again.
 */
export function e2eDb(): Database {
  if (!db) {
    pool = new Pool({ connectionString: resolveTestDatabaseUrl() });
    db = createPostgresDatabase(pool);
  }
  return db;
}

/** Release the worker's connections. */
export async function closeE2eDb(): Promise<void> {
  const closing = pool;
  pool = null;
  db = null;
  if (closing) {
    await closing.end();
  }
}
