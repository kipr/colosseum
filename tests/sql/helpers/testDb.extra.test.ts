/**
 * Tests for testDb helper functions, covering createMinimalTestDb.
 */
import { describe, it, expect } from 'vitest';
import { createMinimalTestDb } from './testDb';

describe('createMinimalTestDb', () => {
  it('creates a minimal database without full schema', async () => {
    const testDb = await createMinimalTestDb();
    try {
      expect(testDb.db).toBeDefined();
      expect(typeof testDb.close).toBe('function');

      // The minimal DB should have no tables from the full schema
      const tables = await testDb.db.all<{ table_name: string }>(
        `SELECT table_name FROM information_schema.tables
         WHERE table_schema = current_schema()`,
      );
      expect(tables.length).toBe(0);
    } finally {
      testDb.close();
    }
  });

  it('supports basic database operations', async () => {
    const testDb = await createMinimalTestDb();
    try {
      await testDb.db.exec(
        'CREATE TABLE test (id SERIAL PRIMARY KEY, val TEXT)',
      );
      const result = await testDb.db.run('INSERT INTO test (val) VALUES (?)', [
        'hello',
      ]);
      expect(result.lastID).toBe(1);

      const row = await testDb.db.get<{ val: string }>(
        'SELECT val FROM test WHERE id = 1',
      );
      expect(row?.val).toBe('hello');
    } finally {
      testDb.close();
    }
  });
});
