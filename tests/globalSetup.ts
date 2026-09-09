/**
 * Vitest global setup: verify the test PostgreSQL server is reachable and
 * remove schemas left behind by earlier runs.
 *
 * Worker schemas are created lazily by `tests/sql/helpers/testDb.ts` inside
 * worker processes. This file runs in the main process, so it cannot see those
 * pools; it cleans up by schema-name prefix instead, which also collects
 * orphans from runs that crashed.
 */
import { Client } from 'pg';

const TEST_SCHEMA_PREFIX = 'colosseum_test_';

async function connect(): Promise<Client> {
  const connectionString = process.env.TEST_DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Tests run against PostgreSQL; ' +
        'start it with `npm run db:up` and set TEST_DATABASE_URL in .env.',
    );
  }

  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (error) {
    throw new Error(
      `Could not connect to the test database at ${connectionString}. ` +
        'Is PostgreSQL running? Try `npm run db:up && npm run db:wait`.\n' +
        `Underlying error: ${(error as Error).message}`,
    );
  }
  return client;
}

async function dropTestSchemas(client: Client): Promise<void> {
  const { rows } = await client.query<{ nspname: string }>(
    `SELECT nspname FROM pg_namespace WHERE nspname LIKE $1`,
    [`${TEST_SCHEMA_PREFIX}%`],
  );
  for (const { nspname } of rows) {
    await client.query(`DROP SCHEMA IF EXISTS "${nspname}" CASCADE`);
  }
}

export async function setup(): Promise<void> {
  const client = await connect();
  try {
    await dropTestSchemas(client);
  } finally {
    await client.end();
  }
}

export async function teardown(): Promise<void> {
  const client = await connect();
  try {
    await dropTestSchemas(client);
  } finally {
    await client.end();
  }
}
