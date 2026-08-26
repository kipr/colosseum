/**
 * Unit tests for database connection utilities.
 * Tests normalizeParam and SqliteAdapter behavior.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import SQLite from 'better-sqlite3';
import type { Pool } from 'pg';
import {
  normalizeParam,
  createSqliteDatabase,
  createPostgresDatabase,
  openSqliteFile,
  closeDatabase,
  __setTestDatabaseAdapter,
} from '../../../src/server/database/connection';

describe('normalizeParam', () => {
  it('returns null for undefined', () => {
    expect(normalizeParam(undefined)).toBeNull();
  });

  it('converts Date to ISO string', () => {
    const d = new Date('2025-03-15T12:00:00Z');
    expect(normalizeParam(d)).toBe('2025-03-15T12:00:00.000Z');
  });

  it('converts boolean true to 1 (boolAsInt)', () => {
    expect(normalizeParam(true)).toBe(1);
  });

  it('converts boolean false to 0 (boolAsInt)', () => {
    expect(normalizeParam(false)).toBe(0);
  });

  it('passes through null', () => {
    expect(normalizeParam(null)).toBeNull();
  });

  it('passes through number', () => {
    expect(normalizeParam(42)).toBe(42);
  });

  it('passes through string', () => {
    expect(normalizeParam('hello')).toBe('hello');
  });

  it('passes through bigint', () => {
    expect(normalizeParam(BigInt(123))).toBe(BigInt(123));
  });

  it('passes through Buffer', () => {
    const buf = Buffer.from('test');
    expect(normalizeParam(buf)).toBe(buf);
  });

  it('stringifies objects to JSON', () => {
    expect(normalizeParam({ a: 1 })).toBe('{"a":1}');
  });
});

describe('createSqliteDatabase', () => {
  it('creates adapter from SQLite instance with foreign keys enabled', async () => {
    const db = new SQLite(':memory:');
    const adapter = createSqliteDatabase(db);

    await adapter.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');

    const insert = await adapter.run('INSERT INTO t (val) VALUES (?)', [
      'test',
    ]);
    expect(insert.lastID).toBe(1);

    const row = await adapter.get<{ val: string }>(
      'SELECT val FROM t WHERE id = ?',
      [1],
    );
    expect(row?.val).toBe('test');

    db.close();
  });

  it('supports transaction with rollback on error', async () => {
    const db = new SQLite(':memory:');
    const adapter = createSqliteDatabase(db);

    await adapter.exec(
      'CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT UNIQUE)',
    );
    await adapter.run('INSERT INTO t (val) VALUES (?)', ['a']);

    await expect(
      adapter.transaction(async (tx) => {
        await tx.run('INSERT INTO t (val) VALUES (?)', ['b']);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');

    const rows = await adapter.all<{ val: string }>('SELECT val FROM t');
    expect(rows.length).toBe(1);
    expect(rows[0].val).toBe('a');

    db.close();
  });

  it('supports transaction with commit on success', async () => {
    const db = new SQLite(':memory:');
    const adapter = createSqliteDatabase(db);

    await adapter.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');

    const result = await adapter.transaction(async (tx) => {
      await tx.run('INSERT INTO t (val) VALUES (?)', ['x']);
      return 42;
    });

    expect(result).toBe(42);
    const rows = await adapter.all<{ val: string }>('SELECT val FROM t');
    expect(rows.length).toBe(1);
    expect(rows[0].val).toBe('x');

    db.close();
  });

  it('supports reads of uncommitted writes inside a transaction', async () => {
    const db = new SQLite(':memory:');
    const adapter = createSqliteDatabase(db);

    await adapter.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');

    await adapter.transaction(async (tx) => {
      await tx.run('INSERT INTO t (val) VALUES (?)', ['pending']);
      const row = await tx.get<{ val: string }>(
        'SELECT val FROM t WHERE val = ?',
        ['pending'],
      );

      expect(row?.val).toBe('pending');
    });

    db.close();
  });
});

describe('createPostgresDatabase', () => {
  it('wraps a pg Pool and converts placeholders', async () => {
    const queries: { sql: string; params: unknown[] | undefined }[] = [];
    const pool = {
      query: async (sql: string, params?: unknown[]) => {
        queries.push({ sql, params });
        return { rows: [{ id: 7, name: 't' }], rowCount: 1 };
      },
    } as unknown as Pool;

    const db = createPostgresDatabase(pool);
    const row = await db.get<{ id: number; name: string }>(
      'SELECT id, name FROM scoresheet_templates WHERE id = ?',
      [7],
    );

    expect(row).toEqual({ id: 7, name: 't' });
    expect(queries[0].sql).toContain('$1');
    expect(queries[0].sql).not.toContain('?');
    expect(queries[0].params).toEqual([7]);
  });
});

describe('openSqliteFile', () => {
  it('fails clearly when a read-only file is missing', () => {
    expect(() =>
      openSqliteFile(path.join(os.tmpdir(), 'colosseum-missing-audit.db'), {
        readonly: true,
      }),
    ).toThrow(/Failed to open SQLite database/);
  });

  it('opens an existing file read-only', async () => {
    const filePath = path.join(
      os.tmpdir(),
      `colosseum-audit-${process.pid}-${Date.now()}.db`,
    );
    const setup = new SQLite(filePath);
    setup.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, val TEXT)');
    setup.prepare('INSERT INTO t (val) VALUES (?)').run('ok');
    setup.close();

    const opened = openSqliteFile(filePath, { readonly: true });
    try {
      const row = await opened.db.get<{ val: string }>(
        'SELECT val FROM t WHERE id = ?',
        [1],
      );
      expect(row?.val).toBe('ok');
      await expect(
        opened.db.run('INSERT INTO t (val) VALUES (?)', ['nope']),
      ).rejects.toThrow();
    } finally {
      opened.close();
      fs.unlinkSync(filePath);
    }
  });
});

describe('closeDatabase', () => {
  beforeEach(() => {
    __setTestDatabaseAdapter(null);
  });

  afterEach(() => {
    __setTestDatabaseAdapter(null);
  });

  it('clears adapter without throwing when no db was opened', async () => {
    await expect(closeDatabase()).resolves.toBeUndefined();
  });
});
