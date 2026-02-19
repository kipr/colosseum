import SQLite from 'better-sqlite3';
import type { Database as SQLiteDatabase } from 'better-sqlite3';
import { Pool } from 'pg';
import path from 'path';
import fs from 'fs';

// Database abstraction to support both SQLite (dev) and PostgreSQL (prod)
const isProduction = process.env.NODE_ENV === 'production';
const usePostgres = isProduction || !!process.env.DATABASE_URL;

let sqliteDb: SQLiteDatabase | null = null;
let pgPool: Pool | null = null;

// PostgreSQL connection pool
function getPgPool(): Pool {
  if (!pgPool) {
    // Cloud SQL connection via Unix socket or TCP
    const connectionConfig = process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {
          user: process.env.DB_USER || 'postgres',
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME || 'colosseum',
          // Cloud SQL Unix socket path
          host:
            process.env.DB_HOST ||
            `/cloudsql/${process.env.CLOUD_SQL_CONNECTION_NAME}`,
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

// PostgreSQL implementation
class PostgresAdapter implements Database {
  constructor(private pool: Pool) {}

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

  private async runInsert(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    queryFn: (sql: string, params?: any[]) => Promise<any>,
    convertedSql: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    params?: any[],
  ): Promise<DatabaseResult> {
    const returningSQL = convertedSql.replace(/;?\s*$/, ' RETURNING id;');
    try {
      const result = await queryFn(returningSQL, params);
      return { lastID: result.rows[0]?.id, changes: result.rowCount || 0 };
    } catch {
      const result = await queryFn(convertedSql, params);
      return { changes: result.rowCount || 0 };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async get<T = any>(sql: string, params?: any[]): Promise<T | undefined> {
    const result = await this.pool.query(
      this.convertSql(sql),
      params ? normalizePgParams(params) : params,
    );
    return result.rows[0];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async all<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.pool.query(
      this.convertSql(sql),
      params ? normalizePgParams(params) : params,
    );
    return result.rows;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async run(sql: string, params?: any[]): Promise<DatabaseResult> {
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
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const tx: Transaction = {
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

  if (usePostgres) {
    console.log('Using PostgreSQL database');
    const pool = getPgPool();
    dbAdapter = new PostgresAdapter(pool);
  } else {
    console.log('Using SQLite database');
    // Ensure database directory exists
    const dbDir = path.join(__dirname, '../../../database');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // sqliteDb = await open({
    //   filename: path.join(__dirname, '../../../database/colosseum.db'),
    //   driver: sqlite3.Database,
    // });
    const sqliteDb = new SQLite(
      path.join(__dirname, '../../../database/colosseum.db'),
    );
    sqliteDb.pragma('foreign_keys = ON;');
    sqliteDb.pragma('journal_mode = WAL');
    sqliteDb.pragma('busy_timeout = 5000');
    dbAdapter = new SqliteAdapter(sqliteDb);
  }

  return dbAdapter;
}

// Export the PostgreSQL pool for session store
export function getPostgresPool(): Pool | null {
  if (usePostgres) {
    return getPgPool();
  }
  return null;
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
  dbAdapter = null;
}

/**
 * TEST ONLY: Set a custom database adapter for route testing.
 * Pass null to clear and allow normal initialization on next getDatabase() call.
 */
export function __setTestDatabaseAdapter(adapter: Database | null): void {
  dbAdapter = adapter;
}
