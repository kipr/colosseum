import type { Database as SQLiteDatabase } from 'better-sqlite3';
import { Pool } from 'pg';

let sqliteDb: SQLiteDatabase | null = null;
let pgPool: Pool | null = null;
let pgUnreachableHint: 'db-up' | null = null;

export type PostgresConfig =
  | { source: 'url'; connectionString: string }
  | {
      source: 'cloudsql';
      user: string;
      password: string | undefined;
      database: string;
      host: string;
    };

const POSTGRES_REQUIRED_MESSAGE =
  'PostgreSQL is required. Copy `.env.example` to `.env`, ' +
  'set `DATABASE_URL`, then run `npm run db:up && npm run db:wait`. ' +
  'Production uses `CLOUD_SQL_CONNECTION_NAME` with `DB_USER`, `DB_PASSWORD`, and `DB_NAME`.';

function envValue(
  env: NodeJS.Dict<string | undefined>,
  key: string,
): string | undefined {
  const trimmed = env[key]?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Choose Postgres connection settings from the current environment.
 * `DATABASE_URL` wins; otherwise Cloud SQL unix-socket vars. `NODE_ENV`
 * is not a dialect signal. Reads env at call time so `.env` can load first.
 */
export function resolvePostgresConfig(
  env: NodeJS.Dict<string | undefined> = process.env,
): PostgresConfig {
  const databaseUrl = envValue(env, 'DATABASE_URL');
  if (databaseUrl) {
    return { source: 'url', connectionString: databaseUrl };
  }

  const connectionName = envValue(env, 'CLOUD_SQL_CONNECTION_NAME');
  if (connectionName) {
    return {
      source: 'cloudsql',
      user: envValue(env, 'DB_USER') || 'postgres',
      password: envValue(env, 'DB_PASSWORD'),
      database: envValue(env, 'DB_NAME') || 'colosseum',
      host: envValue(env, 'DB_HOST') || `/cloudsql/${connectionName}`,
    };
  }

  throw new Error(POSTGRES_REQUIRED_MESSAGE);
}

function describePostgresError(error: unknown): string {
  if (error instanceof AggregateError) {
    return error.errors.map(describePostgresError).join('; ');
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  return code ? `${code} ${message}`.trim() : message;
}

function isUnreachablePostgresError(error: unknown): boolean {
  if (error instanceof AggregateError) {
    const message = error.message?.trim() ?? '';
    return (
      !message ||
      error.errors.some((inner) => isUnreachablePostgresError(inner))
    );
  }
  return (error as { code?: string })?.code === 'ECONNREFUSED';
}

function rethrowPostgresError(
  error: unknown,
  unreachableHint: 'db-up' | null,
): never {
  if (unreachableHint === 'db-up' && isUnreachablePostgresError(error)) {
    throw new Error(
      'Could not connect to PostgreSQL. Is it running? Try `npm run db:up && npm run db:wait`.\n' +
        `Underlying error: ${describePostgresError(error)}`,
      { cause: error },
    );
  }
  throw error;
}

function getPgPool(): Pool {
  if (!pgPool) {
    const config = resolvePostgresConfig();
    pgUnreachableHint = config.source === 'url' ? 'db-up' : null;
    const connectionConfig =
      config.source === 'url'
        ? { connectionString: config.connectionString }
        : {
            user: config.user,
            password: config.password,
            database: config.database,
            host: config.host,
          };

    pgPool = new Pool(connectionConfig);
  }
  return pgPool;
}

// Unified database interface
export interface DatabaseResult {
  lastID?: number;
  changes?: number;
}

/**
 * Transaction interface for use inside Database.transaction() callbacks.
 * Methods are async to support both better-sqlite3 (sync under the hood)
 * and pg (truly async) with a unified API.
 */
export interface Transaction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get<T = any>(sql: string, params?: any[]): Promise<T | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(sql: string, params?: any[]): Promise<DatabaseResult>;
  exec(sql: string): Promise<void>;
}

export interface Database {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get<T = any>(sql: string, params?: any[]): Promise<T | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(sql: string, params?: any[]): Promise<DatabaseResult>;
  exec(sql: string): Promise<void>;
  /**
   * Execute a function inside a database transaction.
   * The callback receives a Transaction object with async methods.
   * If the callback throws, the transaction is rolled back.
   * If the callback returns successfully, the transaction is committed.
   */
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeParamBase(v: any, boolAsInt: boolean): any {
  if (v === undefined) return null;

  if (v instanceof Date) return v.toISOString();

  if (typeof v === 'boolean') return boolAsInt ? (v ? 1 : 0) : v;

  if (
    v === null ||
    typeof v === 'number' ||
    typeof v === 'string' ||
    typeof v === 'bigint' ||
    Buffer.isBuffer(v)
  ) {
    return v;
  }

  return JSON.stringify(v);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeParam(v: any): any {
  return normalizeParamBase(v, true);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizePgParam(v: any): any {
  return normalizeParamBase(v, false);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeParams(params: any[]): any[] {
  return params.map(normalizeParam);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizePgParams(params: any[]): any[] {
  return params.map(normalizePgParam);
}
// SQLite implementation (better-sqlite3)
class SqliteAdapter implements Database {
  private stmtCache = new Map<string, ReturnType<SQLiteDatabase['prepare']>>();

  constructor(private db: SQLiteDatabase) {}

  private stmt(sql: string) {
    let s = this.stmtCache.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.stmtCache.set(sql, s);
    }
    return s;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async get<T = any>(sql: string, params: any[] = []): Promise<T | undefined> {
    return this.stmt(sql).get(normalizeParams(params)) as T | undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async all<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    return this.stmt(sql).all(normalizeParams(params)) as T[];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async run(sql: string, params: any[] = []): Promise<DatabaseResult> {
    const info = this.stmt(sql).run(normalizeParams(params));
    return {
      lastID: Number(info.lastInsertRowid),
      changes: info.changes,
    };
  }

  async exec(sql: string): Promise<void> {
    this.db.exec(sql);
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const tx: Transaction = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      get: async <R = any>(
        sql: string,
        params: any[] = [], // eslint-disable-line @typescript-eslint/no-explicit-any
      ): Promise<R | undefined> => {
        return this.stmt(sql).get(normalizeParams(params)) as R | undefined;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      run: async (sql: string, params: any[] = []): Promise<DatabaseResult> => {
        const info = this.stmt(sql).run(normalizeParams(params));
        return {
          lastID: Number(info.lastInsertRowid),
          changes: info.changes,
        };
      },
      exec: async (sql: string): Promise<void> => {
        this.db.exec(sql);
      },
    };

    this.db.exec('BEGIN');
    try {
      const result = await fn(tx);
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
}

/** Postgres SQLSTATE for a reference to a column that does not exist. */
const PG_UNDEFINED_COLUMN = '42703';

function isUndefinedColumnError(error: unknown): boolean {
  return (error as { code?: string })?.code === PG_UNDEFINED_COLUMN;
}

function insertTargetTable(sql: string): string | null {
  const match = /^\s*INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?([\w.]+)"?/i.exec(sql);
  return match ? match[1].toLowerCase() : null;
}

// PostgreSQL implementation
class PostgresAdapter implements Database {
  /**
   * Tables that have no `id` column, so appending `RETURNING id` to an INSERT
   * would fail. Learned on first use to keep the fallback off the hot path,
   * and so that a savepoint is only ever needed once per table.
   */
  private tablesWithoutId = new Set<string>();

  constructor(
    private pool: Pool,
    private unreachableHint: 'db-up' | null = null,
  ) {}

  private async withUnreachableHint<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (error) {
      rethrowPostgresError(error, this.unreachableHint);
    }
  }

  private convertSql(sql: string): string {
    // Convert ? placeholders to $1, $2, etc.
    let index = 0;
    let converted = sql.replace(/\?/g, () => `$${++index}`);
    // Convert INSERT OR IGNORE to ON CONFLICT DO NOTHING
    converted = converted.replace(
      /INSERT\s+OR\s+IGNORE\s+INTO/gi,
      'INSERT INTO',
    );
    if (/INSERT\s+OR\s+IGNORE/i.test(sql) && !/ON\s+CONFLICT/i.test(sql)) {
      converted = converted.replace(/;?\s*$/, ' ON CONFLICT DO NOTHING');
    }
    return converted;
  }

  /**
   * Run an INSERT, reporting `lastID` the way better-sqlite3 does.
   *
   * `RETURNING id` is appended so the generated key comes back, but a few
   * tables key on something else (`queue_versions` on `event_id`, `session` on
   * `sid`) and reject it. Those are detected by SQLSTATE 42703 and remembered.
   *
   * Inside a transaction the probe has to be wrapped in a savepoint: in
   * PostgreSQL a failed statement aborts the whole transaction, so without one
   * the retry fails with "current transaction is aborted" and the original
   * error is lost. Any error other than 42703 is re-raised so callers still
   * see real constraint violations.
   */
  private async runInsert(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryFn: (sql: string, params?: any[]) => Promise<any>,
    convertedSql: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params?: any[],
    inTransaction = false,
  ): Promise<DatabaseResult> {
    const table = insertTargetTable(convertedSql);

    if (table && this.tablesWithoutId.has(table)) {
      const result = await queryFn(convertedSql, params);
      return { changes: result.rowCount || 0 };
    }

    const returningSQL = convertedSql.replace(/;?\s*$/, ' RETURNING id;');
    const savepoint = inTransaction ? 'colosseum_insert_returning' : null;

    if (savepoint) {
      await queryFn(`SAVEPOINT ${savepoint}`);
    }

    try {
      const result = await queryFn(returningSQL, params);
      if (savepoint) {
        await queryFn(`RELEASE SAVEPOINT ${savepoint}`);
      }
      return { lastID: result.rows[0]?.id, changes: result.rowCount || 0 };
    } catch (error) {
      if (savepoint) {
        await queryFn(`ROLLBACK TO SAVEPOINT ${savepoint}`);
      }
      if (!isUndefinedColumnError(error)) {
        throw error;
      }
      if (table) {
        this.tablesWithoutId.add(table);
      }
      const result = await queryFn(convertedSql, params);
      return { changes: result.rowCount || 0 };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async get<T = any>(sql: string, params?: any[]): Promise<T | undefined> {
    return this.withUnreachableHint(async () => {
      const result = await this.pool.query(
        this.convertSql(sql),
        params ? normalizePgParams(params) : params,
      );
      return result.rows[0];
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async all<T = any>(sql: string, params?: any[]): Promise<T[]> {
    return this.withUnreachableHint(async () => {
      const result = await this.pool.query(
        this.convertSql(sql),
        params ? normalizePgParams(params) : params,
      );
      return result.rows;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async run(sql: string, params?: any[]): Promise<DatabaseResult> {
    return this.withUnreachableHint(async () => {
      const convertedSql = this.convertSql(sql);
      const normalizedParams = params ? normalizePgParams(params) : params;

      if (sql.trim().toUpperCase().startsWith('INSERT')) {
        return this.runInsert(
          (s, p) => this.pool.query(s, p),
          convertedSql,
          normalizedParams,
        );
      }

      const result = await this.pool.query(convertedSql, normalizedParams);
      return { changes: result.rowCount || 0 };
    });
  }

  async exec(sql: string): Promise<void> {
    await this.withUnreachableHint(async () => {
      await this.pool.query(sql);
    });
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.withUnreachableHint(() => this.pool.connect());
    try {
      await client.query('BEGIN');

      const tx: Transaction = {
        get: async <R = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
          sql: string,
          params?: any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        ): Promise<R | undefined> => {
          const result = await client.query(
            this.convertSql(sql),
            params ? normalizePgParams(params) : params,
          );
          return result.rows[0];
        },
        run: async (
          sql: string,
          params?: any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        ): Promise<DatabaseResult> => {
          const convertedSql = this.convertSql(sql);
          const normalizedParams = params ? normalizePgParams(params) : params;

          if (sql.trim().toUpperCase().startsWith('INSERT')) {
            return this.runInsert(
              (s, p) => client.query(s, p),
              convertedSql,
              normalizedParams,
              true,
            );
          }

          const result = await client.query(convertedSql, normalizedParams);
          return { changes: result.rowCount || 0 };
        },
        exec: async (sql: string): Promise<void> => {
          await client.query(sql);
        },
      };

      const result = await fn(tx);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

let dbAdapter: Database | null = null;

export async function getDatabase(): Promise<Database> {
  if (dbAdapter) {
    return dbAdapter;
  }

  console.log('Using PostgreSQL database');
  const pool = getPgPool();
  const adapter = new PostgresAdapter(pool, pgUnreachableHint);
  try {
    await adapter.get('SELECT 1');
  } catch (error) {
    await closeDatabase();
    throw error;
  }
  dbAdapter = adapter;
  return dbAdapter;
}

// Export the PostgreSQL pool for session store
export function getPostgresPool(): Pool {
  return getPgPool();
}

/**
 * Create a SQLite Database adapter from a better-sqlite3 Database instance.
 * Useful for tests that want to use an in-memory database.
 */
export function createSqliteDatabase(db: SQLiteDatabase): Database {
  db.pragma('foreign_keys = ON;');
  return new SqliteAdapter(db);
}

/**
 * Create a PostgreSQL Database adapter from a pg Pool.
 * Useful for tests that own their own pool (for example one scoped to a
 * per-worker schema via the connection's `options` parameter).
 */
export function createPostgresDatabase(pool: Pool): Database {
  return new PostgresAdapter(pool);
}

/**
 * Export normalizeParam for unit testing.
 */
export { normalizeParam };

export async function closeDatabase(): Promise<void> {
  if (sqliteDb) {
    sqliteDb.close();
    sqliteDb = null;
  }
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  pgUnreachableHint = null;
  dbAdapter = null;
}

/**
 * TEST ONLY: Set a custom database adapter for route testing.
 * Pass null to clear and allow normal initialization on next getDatabase() call.
 */
export function __setTestDatabaseAdapter(adapter: Database | null): void {
  dbAdapter = adapter;
}
