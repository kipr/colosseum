import { afterEach, describe, expect, it } from 'vitest';
import type {
  Database,
  DatabaseResult,
  Transaction,
} from '../../../src/server/database/connection';
import { runSchema } from '../../../src/server/database/schema';
import { queueSchema } from '../../../src/server/database/schema/queue';
import { usersSchema } from '../../../src/server/database/schema/users';
import type { SchemaModule } from '../../../src/server/database/schema/types';
import { createMinimalTestDb, type TestDb } from '../../sql/helpers/testDb';

const noop: DatabaseResult = { lastID: 0, changes: 0 };

function schemaModule(
  fields: Omit<SchemaModule, 'name'>,
  name = 'test',
): SchemaModule {
  return { name, ...fields };
}

async function columnNames(
  db: Database,
  table: string,
  columns: string[],
): Promise<string[]> {
  const placeholders = columns.map(() => '?').join(', ');
  const rows = await db.all<{ column_name: string }>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name = ?
       AND column_name IN (${placeholders})
     ORDER BY column_name`,
    [table, ...columns],
  );
  return rows.map((row) => row.column_name);
}

describe('schema runner column additions', () => {
  let testDb: TestDb | undefined;

  afterEach(() => {
    testDb?.close();
    testDb = undefined;
  });

  it('adds a missing column before indexes and remains idempotent', async () => {
    testDb = await createMinimalTestDb();
    const db = testDb.db;
    const createTable = `
      CREATE TABLE IF NOT EXISTS migration_test (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      )
    `;

    await runSchema(db, [schemaModule({ tables: [createTable] }, 'baseline')]);
    await db.run('INSERT INTO migration_test (name) VALUES (?) RETURNING id', [
      'existing',
    ]);

    const upgraded = schemaModule(
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

    await runSchema(db, [upgraded]);

    const existing = await db.get<{ priority: number }>(
      'SELECT priority FROM migration_test WHERE name = ?',
      ['existing'],
    );
    expect(existing?.priority).toBe(10);

    await db.run('INSERT INTO migration_test (name) VALUES (?) RETURNING id', [
      'new',
    ]);
    const inserted = await db.get<{ priority: number }>(
      'SELECT priority FROM migration_test WHERE name = ?',
      ['new'],
    );
    expect(inserted?.priority).toBe(10);

    const index = await db.get<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE schemaname = current_schema()
         AND indexname = 'idx_migration_test_priority'`,
    );
    expect(index?.indexname).toBe('idx_migration_test_priority');

    await expect(runSchema(db, [upgraded])).resolves.toBeUndefined();
    expect(await columnNames(db, 'migration_test', ['priority'])).toEqual([
      'priority',
    ]);
  });

  it('skips a declared addition when a fresh table already has the column', async () => {
    testDb = await createMinimalTestDb();
    const db = testDb.db;
    const module = schemaModule({
      tables: [
        `CREATE TABLE fresh_test (
          id SERIAL PRIMARY KEY,
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

    await expect(runSchema(db, [module])).resolves.toBeUndefined();
    expect(await columnNames(db, 'fresh_test', ['priority'])).toEqual([
      'priority',
    ]);
  });

  it('rolls back a column addition when a later schema phase fails', async () => {
    testDb = await createMinimalTestDb();
    const db = testDb.db;
    const createTable = 'CREATE TABLE rollback_test (id SERIAL PRIMARY KEY)';

    await runSchema(db, [schemaModule({ tables: [createTable] }, 'baseline')]);

    await expect(
      runSchema(db, [
        schemaModule(
          {
            tables: [
              'CREATE TABLE IF NOT EXISTS rollback_test (id SERIAL PRIMARY KEY)',
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

    expect(await columnNames(db, 'rollback_test', ['temporary_value'])).toEqual(
      [],
    );
  });

  it('upgrades legacy queue rows with nullable presence columns idempotently', async () => {
    testDb = await createMinimalTestDb();
    const db = testDb.db;
    await db.exec(`
      CREATE TABLE teams (id SERIAL PRIMARY KEY);
      CREATE TABLE game_queue (
        id SERIAL PRIMARY KEY,
        event_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO game_queue (id, event_id) VALUES (1, 10);
    `);
    const presenceOnly = schemaModule({ columns: queueSchema.columns });

    await runSchema(db, [presenceOnly]);
    await expect(runSchema(db, [presenceOnly])).resolves.toBeUndefined();

    expect(
      await columnNames(db, 'game_queue', [
        'present_team1_id',
        'present_team2_id',
      ]),
    ).toEqual(['present_team1_id', 'present_team2_id']);
    const row = await db.get<{
      present_team1_id: number | null;
      present_team2_id: number | null;
    }>(
      'SELECT present_team1_id, present_team2_id FROM game_queue WHERE id = 1',
    );
    expect(row).toEqual({ present_team1_id: null, present_team2_id: null });
  });
});

describe('schema runner column removals', () => {
  let testDb: TestDb | undefined;

  afterEach(() => {
    testDb?.close();
    testDb = undefined;
  });

  it('purges legacy OAuth tokens while preserving users and remains idempotent', async () => {
    testDb = await createMinimalTestDb();
    const db = testDb.db;
    await db.exec(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        google_id TEXT UNIQUE NOT NULL,
        email TEXT NOT NULL,
        name TEXT,
        access_token TEXT,
        refresh_token TEXT,
        token_expires_at BIGINT,
        is_admin BOOLEAN DEFAULT FALSE,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO users (
        google_id,
        email,
        access_token,
        refresh_token,
        token_expires_at,
        is_admin
      ) VALUES (
        'legacy-google-id',
        'admin@example.com',
        'access-secret',
        'refresh-secret',
        1893456000000,
        TRUE
      );
    `);

    await runSchema(db, [usersSchema]);
    await expect(runSchema(db, [usersSchema])).resolves.toBeUndefined();

    expect(
      await columnNames(db, 'users', [
        'access_token',
        'refresh_token',
        'token_expires_at',
      ]),
    ).toEqual([]);
    expect(
      await db.get('SELECT google_id, email, is_admin FROM users WHERE id = 1'),
    ).toEqual({
      google_id: 'legacy-google-id',
      email: 'admin@example.com',
      is_admin: true,
    });
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
        all: async () => [],
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
  };
}

describe('PostgreSQL schema runner column additions', () => {
  it('checks information_schema and adds a missing column in phase order', async () => {
    const { db, operations } = createRecordingDatabase(false);

    await runSchema(db, [postgresMigrationModule()]);

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

    await runSchema(db, [postgresMigrationModule()]);

    expect(operations.some(({ sql }) => sql.includes('ADD COLUMN'))).toBe(
      false,
    );
    expect(operations.some(({ sql }) => sql.includes('ADD CHECK'))).toBe(true);
  });
});
