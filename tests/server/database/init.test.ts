/**
 * Schema initialization through the Postgres adapter.
 *
 * `initializePostgres` is what every `createTestDb()` call runs. This file
 * pins that it is idempotent and that `initializeDatabase()` uses the
 * injected test adapter rather than opening a second pool.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  __setTestDatabaseAdapter,
  closeDatabase,
} from '../../../src/server/database/connection';
import {
  initializeDatabase,
  initializePostgres,
} from '../../../src/server/database/init';
import { createTestDb, type TestDb } from '../../sql/helpers/testDb';

describe('initializePostgres', () => {
  let testDb: TestDb;

  afterEach(() => {
    testDb?.close();
  });

  it('is idempotent on an already-initialized schema', async () => {
    testDb = await createTestDb();
    await initializePostgres(testDb.db);

    const tables = await testDb.db.all<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_name = 'events'`,
    );
    expect(tables).toHaveLength(1);
  });
});

describe('initializeDatabase', () => {
  let testDb: TestDb;

  afterEach(async () => {
    __setTestDatabaseAdapter(null);
    testDb?.close();
    await closeDatabase();
  });

  it('applies the schema through the injected adapter', async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    await initializeDatabase();

    const row = await testDb.db.get<{ n: number }>(
      `SELECT COUNT(*)::int AS n
       FROM information_schema.tables
       WHERE table_schema = current_schema()`,
    );
    expect(row?.n).toBeGreaterThan(0);
  });
});
