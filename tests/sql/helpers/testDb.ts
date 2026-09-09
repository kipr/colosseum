/**
 * Test database helper - hands out a PostgreSQL schema with the full
 * production schema applied.
 *
 * One schema is created per Vitest worker process and reused. Applying the
 * schema costs ~200 DDL statements, which is too slow to repeat for each of
 * the suite's test cases, so instead every acquire truncates all tables with
 * RESTART IDENTITY. Tests still start from an empty database with sequences
 * reset.
 *
 * Truncating on acquire rather than on release is what lets `close()` stay
 * synchronous, matching how the existing `afterEach` hooks call it.
 *
 * `search_path` is pinned through the connection's `options` parameter so that
 * every connection handed out by the pool is already scoped to the worker's
 * schema. Setting it per query would leak into the `public` schema whenever a
 * connection was returned to the pool.
 */
import { Pool } from 'pg';
import {
  createPostgresDatabase,
  Database,
} from '../../../src/server/database/connection';
import { initializePostgres } from '../../../src/server/database/init';

/** Schemas created by the test harness all share this prefix. */
export const TEST_SCHEMA_PREFIX = 'colosseum_test_';

export interface TestDb {
  /** The Database adapter interface (same as production code uses) */
  db: Database;
  /** Release the database. Truncation happens on the next acquire. */
  close: () => void;
}

export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Start PostgreSQL with `npm run db:up` ' +
        'and set TEST_DATABASE_URL in .env.',
    );
  }
  return url;
}

/** Unique per worker process, so parallel workers cannot see each other. */
function workerSchemaName(): string {
  return `${TEST_SCHEMA_PREFIX}w${process.env.VITEST_WORKER_ID ?? '0'}_${process.pid}`;
}

export function createSchemaScopedPool(schema: string): Pool {
  return new Pool({
    connectionString: testDatabaseUrl(),
    options: `-c search_path=${schema}`,
  });
}

interface WorkerSchema {
  pool: Pool;
  truncateSql: string;
}

let workerSchema: Promise<WorkerSchema> | null = null;
let workerPool: Pool | null = null;
let minimalCounter = 0;

async function getWorkerSchema(): Promise<WorkerSchema> {
  if (!workerSchema) {
    workerSchema = (async () => {
      const schema = workerSchemaName();
      const pool = createSchemaScopedPool(schema);
      workerPool = pool;

      await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await pool.query(`CREATE SCHEMA ${schema}`);

      const db = createPostgresDatabase(pool);
      await initializePostgres(db);

      const { rows } = await pool.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = $1 AND table_type = 'BASE TABLE'`,
        [schema],
      );
      const tables = rows.map((r) => `${schema}."${r.table_name}"`);

      return {
        pool,
        truncateSql: `TRUNCATE ${tables.join(', ')} RESTART IDENTITY CASCADE`,
      };
    })();
  }
  return workerSchema;
}

/**
 * Acquire the worker's database with the full schema applied and no rows.
 *
 * A new adapter is returned each time even though the pool is shared.
 * Services such as `queueSync` key per-database caches off the adapter's
 * object identity, so reusing one adapter would leak that state between
 * tests. Constructing an adapter is just an object allocation.
 */
export async function createTestDb(): Promise<TestDb> {
  const { pool, truncateSql } = await getWorkerSchema();
  const db = createPostgresDatabase(pool);
  await db.exec(truncateSql);
  return { db, close: () => {} };
}

/**
 * Create an empty schema with no tables.
 * Useful for testing the adapter itself without schema overhead.
 */
export async function createMinimalTestDb(): Promise<TestDb> {
  const schema = `${workerSchemaName()}_min_${minimalCounter++}`;
  const pool = createSchemaScopedPool(schema);
  await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
  await pool.query(`CREATE SCHEMA ${schema}`);

  return {
    db: createPostgresDatabase(pool),
    close: () => {
      void pool.end();
    },
  };
}

/** Release the worker's pool. Called from the Vitest setup file teardown. */
export async function closeTestDbPool(): Promise<void> {
  const pool = workerPool;
  workerPool = null;
  workerSchema = null;
  if (pool) {
    await pool.end();
  }
}
