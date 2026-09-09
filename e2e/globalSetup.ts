/**
 * Playwright global setup: start the run from an empty test database.
 *
 * Each spec cleans up after itself, but a run that crashes leaves rows behind,
 * and those can break later runs (unique team numbers, access codes, spectator
 * listings that assert on visible events). Truncating once up front makes that
 * self-healing.
 *
 * Playwright starts `webServer` before this file, so the e2e Express server has
 * already applied the schema through `initializeDatabase()`.
 */
import { Client } from 'pg';
import { resolveTestDatabaseUrl } from '../config/testDatabaseUrl';

/**
 * The suite truncates every table it finds, so refuse to run anywhere that is
 * not recognisably a test database. `colosseum` is the dev database.
 */
function assertTestDatabase(connectionString: string): void {
  const database = decodeURIComponent(
    new URL(connectionString).pathname.replace(/^\//, ''),
  );
  if (!/(^|_)test(_|$)/.test(database)) {
    throw new Error(
      `Refusing to run the e2e suite against database "${database}": the ` +
        'suite truncates every table, so TEST_DATABASE_URL must point at a ' +
        'test database such as colosseum_test.',
    );
  }
}

async function globalSetup(): Promise<void> {
  const connectionString = resolveTestDatabaseUrl();
  assertTestDatabase(connectionString);

  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Could not connect to the e2e database at ${connectionString}. ` +
        'Is PostgreSQL running? Try `npm run db:up && npm run db:wait`.\n' +
        `Underlying error: ${describeError(error)}`,
    );
  }

  try {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    if (rows.length === 0) {
      throw new Error(
        `No tables found in the public schema of ${connectionString}. The ` +
          'e2e server should have created them on startup; check its output.',
      );
    }
    const tables = rows.map((r) => `public."${r.table_name}"`).join(', ');
    await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  } finally {
    await client.end();
  }
}

/** pg reports a refused connection as an AggregateError with no message. */
function describeError(error: unknown): string {
  if (error instanceof AggregateError) {
    return error.errors.map(describeError).join('; ');
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  return code ? `${code} ${message}`.trim() : message;
}

export default globalSetup;
