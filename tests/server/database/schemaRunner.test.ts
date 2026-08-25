import SQLite from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createSqliteDatabase,
  type Database,
  type DatabaseResult,
  type Transaction,
} from '../../../src/server/database/connection';
import { runSchema } from '../../../src/server/database/schema';
import { queueSchema } from '../../../src/server/database/schema/queue';
import type { SchemaModule } from '../../../src/server/database/schema/types';

const noop: DatabaseResult = { lastID: 0, changes: 0 };

function sqliteModule(
  sqlite: SchemaModule['sqlite'],
  name = 'test',
): SchemaModule {
  return {
    name,
    postgres: {},
    sqlite,
  };
}

describe('schema runner column additions', () => {
  let sqlite: SQLite.Database | undefined;

  afterEach(() => {
    sqlite?.close();
    sqlite = undefined;
  });

  it('adds a missing SQLite column before indexes and remains idempotent', async () => {
    sqlite = new SQLite(':memory:');
    const db = createSqliteDatabase(sqlite);
    const createTable = `
      CREATE TABLE IF NOT EXISTS migration_test (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL
      )
    `;

    await runSchema(db, 'sqlite', [
      sqliteModule({ tables: [createTable] }, 'baseline'),
    ]);
    await db.run('INSERT INTO migration_test (name) VALUES (?)', ['existing']);

    const upgraded = sqliteModule(
      {
        tables: [createTable],
        columns: [
          {
            table: 'migration_test',
            column: 'priority',
            definition: 'INTEGER NOT NULL DEFAULT 10',
          },
        ],
        indexes: [
          'CREATE INDEX IF NOT EXISTS idx_migration_test_priority ON migration_test(priority)',
        ],
      },
      'upgraded',
    );

    await runSchema(db, 'sqlite', [upgraded]);

    const existing = await db.get<{ priority: number }>(
      'SELECT priority FROM migration_test WHERE name = ?',
      ['existing'],
    );
    expect(existing?.priority).toBe(10);

    await db.run('INSERT INTO migration_test (name) VALUES (?)', ['new']);
    const inserted = await db.get<{ priority: number }>(
      'SELECT priority FROM migration_test WHERE name = ?',
      ['new'],
    );
    expect(inserted?.priority).toBe(10);

    const index = await db.get<{ name: string }>(
      `SELECT name FROM sqlite_master
       WHERE type = 'index' AND name = 'idx_migration_test_priority'`,
    );
    expect(index?.name).toBe('idx_migration_test_priority');

    await expect(runSchema(db, 'sqlite', [upgraded])).resolves.toBeUndefined();
    const columns = await db.all<{ name: string }>(
      'SELECT name FROM pragma_table_info(?) WHERE name = ?',
      ['migration_test', 'priority'],
    );
    expect(columns).toHaveLength(1);
  });

  it('skips a declared addition when a fresh table already has the column', async () => {
    sqlite = new SQLite(':memory:');
    const db = createSqliteDatabase(sqlite);
    const module = sqliteModule({
      tables: [
        `CREATE TABLE fresh_test (
          id INTEGER PRIMARY KEY,
          priority INTEGER NOT NULL DEFAULT 10
        )`,
      ],
      columns: [
        {
          table: 'fresh_test',
          column: 'priority',
          definition: 'INTEGER NOT NULL DEFAULT 10',
        },
      ],
    });

    await expect(runSchema(db, 'sqlite', [module])).resolves.toBeUndefined();
    const columns = await db.all<{ name: string }>(
      'SELECT name FROM pragma_table_info(?) WHERE name = ?',
      ['fresh_test', 'priority'],
    );
    expect(columns).toHaveLength(1);
  });

  it('rolls back a column addition when a later schema phase fails', async () => {
    sqlite = new SQLite(':memory:');
    const db = createSqliteDatabase(sqlite);
    const createTable = 'CREATE TABLE rollback_test (id INTEGER PRIMARY KEY)';

    await runSchema(db, 'sqlite', [
      sqliteModule({ tables: [createTable] }, 'baseline'),
    ]);

    await expect(
      runSchema(db, 'sqlite', [
        sqliteModule(
          {
            tables: [
              'CREATE TABLE IF NOT EXISTS rollback_test (id INTEGER PRIMARY KEY)',
            ],
            columns: [
              {
                table: 'rollback_test',
                column: 'temporary_value',
                definition: 'TEXT',
              },
            ],
            constraints: ['INVALID SCHEMA STATEMENT'],
          },
          'broken-upgrade',
        ),
      ]),
    ).rejects.toThrow();

    const column = await db.get(
      'SELECT 1 FROM pragma_table_info(?) WHERE name = ?',
      ['rollback_test', 'temporary_value'],
    );
    expect(column).toBeUndefined();
  });

  it('upgrades legacy queue rows with nullable presence columns idempotently', async () => {
    sqlite = new SQLite(':memory:');
    const db = createSqliteDatabase(sqlite);
    await db.exec(`
      CREATE TABLE teams (id INTEGER PRIMARY KEY);
      CREATE TABLE game_queue (
        id INTEGER PRIMARY KEY,
        event_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO game_queue (id, event_id) VALUES (1, 10);
    `);
    const presenceOnly = sqliteModule({ columns: queueSchema.sqlite.columns });

    await runSchema(db, 'sqlite', [presenceOnly]);
    await expect(
      runSchema(db, 'sqlite', [presenceOnly]),
    ).resolves.toBeUndefined();

    const columns = await db.all<{ name: string }>(
      `SELECT name FROM pragma_table_info('game_queue')
       WHERE name IN ('present_team1_id', 'present_team2_id')
       ORDER BY name`,
    );
    expect(columns.map((column) => column.name)).toEqual([
      'present_team1_id',
      'present_team2_id',
    ]);
    const row = await db.get<{
      present_team1_id: number | null;
      present_team2_id: number | null;
    }>(
      'SELECT present_team1_id, present_team2_id FROM game_queue WHERE id = 1',
    );
    expect(row).toEqual({ present_team1_id: null, present_team2_id: null });
  });
});

interface RecordedOperation {
  kind: 'exec' | 'get';
  sql: string;
  params?: unknown[];
}

function createRecordingDatabase(columnAlreadyExists: boolean): {
  db: Database;
  operations: RecordedOperation[];
} {
  const operations: RecordedOperation[] = [];
  const recordGet = async <T>(
    sql: string,
    params?: unknown[],
  ): Promise<T | undefined> => {
    operations.push({ kind: 'get', sql, params });
    return columnAlreadyExists ? ({ present: 1 } as T) : undefined;
  };
  const recordExec = async (sql: string): Promise<void> => {
    operations.push({ kind: 'exec', sql });
  };

  const db: Database = {
    get: recordGet,
    all: async () => [],
    run: async () => noop,
    exec: recordExec,
    transaction: async <T>(fn: (tx: Transaction) => Promise<T>) => {
      const tx: Transaction = {
        get: recordGet,
        run: async () => noop,
        exec: recordExec,
      };
      return fn(tx);
    },
  };

  return { db, operations };
}

function postgresMigrationModule(): SchemaModule {
  return {
    name: 'postgres-migration',
    postgres: {
      tables: ['CREATE TABLE migration_test (id INTEGER PRIMARY KEY)'],
      columns: [
        {
          table: 'migration_test',
          column: 'priority',
          definition: 'INTEGER NOT NULL DEFAULT 10',
        },
      ],
      constraints: ['ALTER TABLE migration_test ADD CHECK (priority > 0)'],
      indexes: [
        'CREATE INDEX idx_migration_priority ON migration_test(priority)',
      ],
    },
    sqlite: {},
  };
}

describe('PostgreSQL schema runner column additions', () => {
  it('checks information_schema and adds a missing column in phase order', async () => {
    const { db, operations } = createRecordingDatabase(false);

    await runSchema(db, 'postgres', [postgresMigrationModule()]);

    expect(operations.map(({ kind }) => kind)).toEqual([
      'exec',
      'get',
      'exec',
      'exec',
      'exec',
    ]);
    expect(operations[1].sql).toContain('FROM information_schema.columns');
    expect(operations[1].sql).toContain('table_schema = current_schema()');
    expect(operations[1].params).toEqual(['migration_test', 'priority']);
    expect(operations[2].sql).toBe(
      'ALTER TABLE "migration_test" ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 10',
    );
    expect(operations[3].sql).toContain('ADD CHECK');
    expect(operations[4].sql).toContain('CREATE INDEX');
  });

  it('does not alter PostgreSQL when the column already exists', async () => {
    const { db, operations } = createRecordingDatabase(true);

    await runSchema(db, 'postgres', [postgresMigrationModule()]);

    expect(operations.some(({ sql }) => sql.includes('ADD COLUMN'))).toBe(
      false,
    );
    expect(operations.some(({ sql }) => sql.includes('ADD CHECK'))).toBe(true);
  });
});
