import { Pool } from 'pg';

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
  'Production uses `DB_HOST` or `CLOUD_SQL_CONNECTION_NAME` with ' +
  '`DB_USER`, `DB_PASSWORD`, and `DB_NAME`.';

function envValue(
  env: NodeJS.Dict<string | undefined>,
  key: string,
): string | undefined {
  const trimmed = env[key]?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Choose Postgres connection settings from the current environment.
 * `DATABASE_URL` wins; otherwise Cloud SQL TCP or unix-socket vars.
 * `NODE_ENV` is not a dialect signal. Reads env at call time so `.env` can
 * load first.
 */
export function resolvePostgresConfig(
  env: NodeJS.Dict<string | undefined> = process.env,
): PostgresConfig {
  const databaseUrl = envValue(env, 'DATABASE_URL');
  if (databaseUrl) {
    return { source: 'url', connectionString: databaseUrl };
  }

  const dbHost = envValue(env, 'DB_HOST');
  const connectionName = envValue(env, 'CLOUD_SQL_CONNECTION_NAME');
  if (dbHost || connectionName) {
    return {
      source: 'cloudsql',
      user: envValue(env, 'DB_USER') || 'postgres',
      password: envValue(env, 'DB_PASSWORD'),
      database: envValue(env, 'DB_NAME') || 'colosseum',
      host: dbHost || `/cloudsql/${connectionName}`,
    };
  }

  throw new Error(POSTGRES_REQUIRED_MESSAGE);
}

function isAggregateError(
  error: unknown,
): error is Error & { errors: unknown[] } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'errors' in error &&
    Array.isArray((error as { errors: unknown }).errors)
  );
}

function describePostgresError(error: unknown): string {
  if (isAggregateError(error)) {
    return error.errors.map(describePostgresError).join('; ');
  }
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code;
  return code ? `${code} ${message}`.trim() : message;
}

function isUnreachablePostgresError(error: unknown): boolean {
  if (isAggregateError(error)) {
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
  /** Set from `RETURNING id`. Omitted when the statement does not return `id`. */
  lastID?: number;
  changes?: number;
}

/**
 * Query methods shared by pool connections and open transactions.
 * Pass this type to helpers that must run on either a `Database` or a `Transaction`.
 */
export interface DbExecutor {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get<T = any>(sql: string, params?: any[]): Promise<T | undefined>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(sql: string, params?: any[]): Promise<DatabaseResult>;
  exec(sql: string): Promise<void>;
}

/**
 * Transaction interface for use inside Database.transaction() callbacks.
 * Methods are async to match the PostgreSQL client.
 */
export type Transaction = DbExecutor;

export interface Database extends DbExecutor {
  /**
   * Execute a function inside a database transaction.
   * The callback receives a Transaction object with async methods.
   * If the callback throws, the transaction is rolled back.
   * If the callback returns successfully, the transaction is committed.
   */
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
}

/** True when `db` can open its own transaction (pool adapter, not an open tx). */
export function isDatabase(db: DbExecutor): db is Database {
  return typeof (db as Database).transaction === 'function';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeParam(v: any): any {
  if (v === undefined) return null;

  if (v instanceof Date) return v.toISOString();

  if (typeof v === 'boolean') return v;

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
function normalizeParams(params: any[]): any[] {
  return params.map(normalizeParam);
}

/** Convert application `?` placeholders to Postgres `$1`, `$2`, … */
function convertSql(sql: string): string {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

/**
 * `lastID` is populated only when the statement used `RETURNING id`.
 * Callers that need the generated key must request it in the SQL; the
 * adapter does not probe or append `RETURNING`.
 */
function resultFromQuery(result: {
  rows: Array<{ id?: number }>;
  rowCount: number | null;
}): DatabaseResult {
  return { lastID: result.rows[0]?.id, changes: result.rowCount || 0 };
}

// PostgreSQL implementation
class PostgresAdapter implements Database {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async get<T = any>(sql: string, params?: any[]): Promise<T | undefined> {
    return this.withUnreachableHint(async () => {
      const result = await this.pool.query(
        convertSql(sql),
        params ? normalizeParams(params) : params,
      );
      return result.rows[0];
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async all<T = any>(sql: string, params?: any[]): Promise<T[]> {
    return this.withUnreachableHint(async () => {
      const result = await this.pool.query(
        convertSql(sql),
        params ? normalizeParams(params) : params,
      );
      return result.rows;
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async run(sql: string, params?: any[]): Promise<DatabaseResult> {
    return this.withUnreachableHint(async () => {
      const result = await this.pool.query(
        convertSql(sql),
        params ? normalizeParams(params) : params,
      );
      return resultFromQuery(result);
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
            convertSql(sql),
            params ? normalizeParams(params) : params,
          );
          return result.rows[0];
        },
        all: async <R = any>( // eslint-disable-line @typescript-eslint/no-explicit-any
          sql: string,
          params?: any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        ): Promise<R[]> => {
          const result = await client.query(
            convertSql(sql),
            params ? normalizeParams(params) : params,
          );
          return result.rows;
        },
        run: async (
          sql: string,
          params?: any[], // eslint-disable-line @typescript-eslint/no-explicit-any
        ): Promise<DatabaseResult> => {
          const result = await client.query(
            convertSql(sql),
            params ? normalizeParams(params) : params,
          );
          return resultFromQuery(result);
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
