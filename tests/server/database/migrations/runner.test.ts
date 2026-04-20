/**
 * Unit tests for the migration runner.
 *
 * Uses an in-memory SQLite database via createMinimalTestDb to exercise
 * runMigrations without depending on the production baseline.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMinimalTestDb, TestDb } from '../../../sql/helpers/testDb';
import {
  runMigrations,
  ensureSchemaMigrationsTable,
  type Migration,
} from '../../../../src/server/database/migrations/runner';

describe('runMigrations', () => {
  let testDb: TestDb;

  beforeEach(() => {
    testDb = createMinimalTestDb();
  });

  afterEach(() => {
    testDb.close();
  });

  it('creates schema_migrations on first run with empty list', async () => {
    await runMigrations(testDb.db, 'sqlite', []);
    const rows = await testDb.db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`,
    );
    expect(rows).toHaveLength(1);

    const applied = await testDb.db.all(`SELECT * FROM schema_migrations`);
    expect(applied).toEqual([]);
  });

  it('runs each migration exactly once across multiple invocations', async () => {
    const calls: string[] = [];
    const migrations: Migration[] = [
      {
        id: '0001_a',
        name: 'a',
        up: async (db) => {
          calls.push('a');
          await db.exec(`CREATE TABLE a (id INTEGER PRIMARY KEY)`);
        },
      },
      {
        id: '0002_b',
        name: 'b',
        up: async (db) => {
          calls.push('b');
          await db.exec(`CREATE TABLE b (id INTEGER PRIMARY KEY)`);
        },
      },
    ];

    await runMigrations(testDb.db, 'sqlite', migrations);
    await runMigrations(testDb.db, 'sqlite', migrations);

    expect(calls).toEqual(['a', 'b']);

    const applied = await testDb.db.all<{ id: string }>(
      `SELECT id FROM schema_migrations ORDER BY id`,
    );
    expect(applied.map((r) => r.id)).toEqual(['0001_a', '0002_b']);
  });

  it('leaves no schema_migrations row when a migration throws', async () => {
    const migrations: Migration[] = [
      {
        id: '0001_ok',
        name: 'ok',
        up: async (db) => {
          await db.exec(`CREATE TABLE ok (id INTEGER PRIMARY KEY)`);
        },
      },
      {
        id: '0002_boom',
        name: 'boom',
        up: async () => {
          throw new Error('boom');
        },
      },
    ];

    await expect(
      runMigrations(testDb.db, 'sqlite', migrations),
    ).rejects.toThrow(/boom/);

    const applied = await testDb.db.all<{ id: string }>(
      `SELECT id FROM schema_migrations ORDER BY id`,
    );
    expect(applied.map((r) => r.id)).toEqual(['0001_ok']);

    // Re-running picks up at the failed migration.
    let secondRunCalled = false;
    const fixed: Migration[] = [
      migrations[0],
      {
        id: '0002_boom',
        name: 'boom (fixed)',
        up: async (db) => {
          secondRunCalled = true;
          await db.exec(`CREATE TABLE fixed (id INTEGER PRIMARY KEY)`);
        },
      },
    ];
    await runMigrations(testDb.db, 'sqlite', fixed);
    expect(secondRunCalled).toBe(true);

    const finalApplied = await testDb.db.all<{ id: string }>(
      `SELECT id FROM schema_migrations ORDER BY id`,
    );
    expect(finalApplied.map((r) => r.id)).toEqual(['0001_ok', '0002_boom']);
  });

  it('supports non-transactional migrations', async () => {
    let ran = false;
    const m: Migration = {
      id: '0001_no_tx',
      name: 'no tx',
      transactional: false,
      up: async (db) => {
        ran = true;
        // Toggle a PRAGMA -- something that wouldn't be valid inside a tx
        // boundary in some setups -- to ensure we're outside of one.
        await db.exec(`PRAGMA foreign_keys=OFF`);
        await db.exec(`CREATE TABLE no_tx (id INTEGER PRIMARY KEY)`);
        await db.exec(`PRAGMA foreign_keys=ON`);
      },
    };

    await runMigrations(testDb.db, 'sqlite', [m]);
    expect(ran).toBe(true);

    const applied = await testDb.db.all<{ id: string }>(
      `SELECT id FROM schema_migrations`,
    );
    expect(applied.map((r) => r.id)).toEqual(['0001_no_tx']);
  });

  it('ensureSchemaMigrationsTable is idempotent', async () => {
    await ensureSchemaMigrationsTable(testDb.db);
    await ensureSchemaMigrationsTable(testDb.db);
    const rows = await testDb.db.all<{ name: string }>(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'`,
    );
    expect(rows).toHaveLength(1);
  });
});
