import sqlite3 from 'sqlite3';
import { open, Database as SqliteDatabase } from 'sqlite';
import { Pool, PoolClient } from 'pg';
import path from 'path';
import fs from 'fs';

// Database abstraction to support both SQLite (dev) and PostgreSQL (prod)
const isProduction = process.env.NODE_ENV === 'production';
const usePostgres = isProduction || !!process.env.DATABASE_URL;

let sqliteDb: SqliteDatabase | null = null;
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

export interface Database {
  get<T = any>(sql: string, params?: any[]): Promise<T | undefined>;
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
  run(sql: string, params?: any[]): Promise<DatabaseResult>;
  exec(sql: string): Promise<void>;
}

// SQLite implementation
class SqliteAdapter implements Database {
  constructor(private db: SqliteDatabase) {}

  async get<T = any>(sql: string, params?: any[]): Promise<T | undefined> {
    return this.db.get(sql, params);
  }

  async all<T = any>(sql: string, params?: any[]): Promise<T[]> {
    return this.db.all(sql, params);
  }

  async run(sql: string, params?: any[]): Promise<DatabaseResult> {
    const result = await this.db.run(sql, params);
    return { lastID: result.lastID, changes: result.changes };
  }

  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
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

  async get<T = any>(sql: string, params?: any[]): Promise<T | undefined> {
    const result = await this.pool.query(this.convertPlaceholders(sql), params);
    return result.rows[0];
  }

  async all<T = any>(sql: string, params?: any[]): Promise<T[]> {
    const result = await this.pool.query(this.convertPlaceholders(sql), params);
    return result.rows;
  }

  async run(sql: string, params?: any[]): Promise<DatabaseResult> {
    const convertedSql = this.convertPlaceholders(sql);

    // For INSERT statements, try to get the lastID
    if (sql.trim().toUpperCase().startsWith('INSERT')) {
      const returningSQL = convertedSql.replace(/;?\s*$/, ' RETURNING id;');
      try {
        const result = await this.pool.query(returningSQL, params);
        return { lastID: result.rows[0]?.id, changes: result.rowCount || 0 };
      } catch (e) {
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

    sqliteDb = await open({
      filename: path.join(__dirname, '../../../database/colosseum.db'),
      driver: sqlite3.Database,
    });
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
