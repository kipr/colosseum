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
 * Synchronous transaction interface for use inside Database.transaction() callbacks.
 * Methods are synchronous because better-sqlite3's .transaction() requires a sync callback.
 */
export interface Transaction {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(sql: string, params?: any[]): DatabaseResult;
  exec(sql: string): void;
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
   * The callback receives a Transaction object with synchronous methods.
   * If the callback throws, the transaction is rolled back.
   * If the callback returns successfully, the transaction is committed.
   */
  transaction<T>(fn: (tx: Transaction) => T): Promise<T>;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeParam(v: any): any {
  // SQLite cannot bind undefined; treat it as NULL.
  if (v === undefined) return null;

  // Dates are common: store as ISO string (or v.getTime() if you prefer integers).
  if (v instanceof Date) return v.toISOString();

  // Booleans: SQLite doesn't have a real boolean type; use 0/1.
  if (typeof v === 'boolean') return v ? 1 : 0;

  // Bigint is allowed by better-sqlite3, leave it.
  // Numbers, strings, null, Buffers are allowed, leave them.
  if (
    v === null ||
    typeof v === 'number' ||
    typeof v === 'string' ||
    typeof v === 'bigint' ||
    Buffer.isBuffer(v)
  ) {
    return v;
  }

  // If you *intend* to store JSON blobs, stringify objects/arrays.
  // If not intended, you may prefer to throw instead to catch bugs earlier.
  return JSON.stringify(v);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeParams(params: any[]): any[] {
  return params.map(normalizeParam);
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

  async transaction<T>(fn: (tx: Transaction) => T): Promise<T> {
    // Create a transaction object with synchronous methods
    const tx: Transaction = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      run: (sql: string, params: any[] = []): DatabaseResult => {
        const info = this.stmt(sql).run(normalizeParams(params));
        return {
          lastID: Number(info.lastInsertRowid),
          changes: info.changes,
        };
      },
      exec: (sql: string): void => {
        this.db.exec(sql);
      },
    };

    // Use better-sqlite3's .transaction() which wraps the callback in BEGIN/COMMIT
    // and automatically rolls back on exception
    const wrappedFn = this.db.transaction(() => fn(tx));
    return Promise.resolve(wrappedFn());
  }
}

// PostgreSQL implementation
class PostgresAdapter implements Database {
  constructor(private pool: Pool) {}

  // Convert SQLite ? placeholders to PostgreSQL $1, $2, etc.
  private convertPlaceholders(sql: string): string {
    let index = 0;
    return sql.replace(/\?/g, () => `$${++index}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async get<T = any>(sql: string, params?: any[]): Promise<T | undefined> {
    const result = await this.pool.query(this.convertPlaceholders(sql), params);
    return result.rows[0];
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async all<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.pool.query(this.convertPlaceholders(sql), params);
    return result.rows;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async run(sql: string, params?: any[]): Promise<DatabaseResult> {
    const convertedSql = this.convertPlaceholders(sql);

    // For INSERT statements, try to get the lastID
    if (sql.trim().toUpperCase().startsWith('INSERT')) {
      const returningSQL = convertedSql.replace(/;?\s*$/, ' RETURNING id;');
      try {
        const result = await this.pool.query(returningSQL, params);
        return { lastID: result.rows[0]?.id, changes: result.rowCount || 0 };
      } catch {
        // If RETURNING fails (no id column), just run normally
        const result = await this.pool.query(convertedSql, params);
        return { changes: result.rowCount || 0 };
      }
    }

    const result = await this.pool.query(convertedSql, params);
    return { changes: result.rowCount || 0 };
  }

  async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  async transaction<T>(fn: (tx: Transaction) => T): Promise<T> {
    // Collect operations during the synchronous callback execution
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const operations: { type: 'run' | 'exec'; sql: string; params?: any[] }[] =
      [];
    const results: DatabaseResult[] = [];

    const tx: Transaction = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      run: (sql: string, params?: any[]): DatabaseResult => {
        const idx = operations.length;
        operations.push({ type: 'run', sql, params });
        // Return a placeholder result - actual results are populated after execution
        // For synchronous API compatibility, we return an empty result
        // The actual results will be available after the transaction completes
        results[idx] = { changes: 0 };
        return results[idx];
      },
      exec: (sql: string): void => {
        operations.push({ type: 'exec', sql });
      },
    };

    // Execute the callback synchronously to collect operations
    const callbackResult = fn(tx);

    // Now execute all operations within a single transaction
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (let i = 0; i < operations.length; i++) {
        const op = operations[i];
        const convertedSql = this.convertPlaceholders(op.sql);

        if (op.type === 'run') {
          // For INSERT statements, try to get the lastID
          if (op.sql.trim().toUpperCase().startsWith('INSERT')) {
            const returningSQL = convertedSql.replace(
              /;?\s*$/,
              ' RETURNING id;',
            );
            try {
              const result = await client.query(returningSQL, op.params);
              results[i] = {
                lastID: result.rows[0]?.id,
                changes: result.rowCount || 0,
              };
            } catch {
              // If RETURNING fails (no id column), just run normally
              const result = await client.query(convertedSql, op.params);
              results[i] = { changes: result.rowCount || 0 };
            }
          } else {
            const result = await client.query(convertedSql, op.params);
            results[i] = { changes: result.rowCount || 0 };
          }
        } else {
          // exec
          await client.query(op.sql);
        }
      }

      await client.query('COMMIT');
      return callbackResult;
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

export async function closeDatabase(): Promise<void> {
  if (sqliteDb) {
    await sqliteDb.close();
    sqliteDb = null;
  }
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  dbAdapter = null;
}
