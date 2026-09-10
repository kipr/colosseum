/**
 * Unit tests for database connection utilities.
 * Tests normalizeParam and Postgres config / unreachable-server behavior.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import net from 'net';
import {
  normalizeParam,
  closeDatabase,
  getDatabase,
  resolvePostgresConfig,
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

  it('passes through boolean true', () => {
    expect(normalizeParam(true)).toBe(true);
  });

  it('passes through boolean false', () => {
    expect(normalizeParam(false)).toBe(false);
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

describe('resolvePostgresConfig', () => {
  const sampleUrl = 'postgres://colosseum:colosseum@localhost:5432/colosseum';

  it('prefers DATABASE_URL over Cloud SQL vars', () => {
    expect(
      resolvePostgresConfig({
        DATABASE_URL: sampleUrl,
        CLOUD_SQL_CONNECTION_NAME: 'proj:region:inst',
        DB_USER: 'cloud',
        DB_PASSWORD: 'secret',
        DB_NAME: 'prod',
      }),
    ).toEqual({ source: 'url', connectionString: sampleUrl });
  });

  it('uses a Cloud SQL unix socket when DATABASE_URL is absent', () => {
    expect(
      resolvePostgresConfig({
        CLOUD_SQL_CONNECTION_NAME: 'proj:region:inst',
        DB_USER: 'cloud',
        DB_PASSWORD: 'secret',
        DB_NAME: 'prod',
      }),
    ).toEqual({
      source: 'cloudsql',
      user: 'cloud',
      password: 'secret',
      database: 'prod',
      host: '/cloudsql/proj:region:inst',
    });
  });

  it('honors DB_HOST for Cloud SQL TCP', () => {
    expect(
      resolvePostgresConfig({
        CLOUD_SQL_CONNECTION_NAME: 'proj:region:inst',
        DB_HOST: '127.0.0.1',
      }),
    ).toMatchObject({
      source: 'cloudsql',
      user: 'postgres',
      database: 'colosseum',
      host: '127.0.0.1',
    });
  });

  it('uses DB_HOST without requiring a Cloud SQL connection name', () => {
    expect(
      resolvePostgresConfig({
        DB_HOST: '10.30.0.3',
        DB_USER: 'cloud',
        DB_PASSWORD: 'secret',
        DB_NAME: 'prod',
      }),
    ).toEqual({
      source: 'cloudsql',
      user: 'cloud',
      password: 'secret',
      database: 'prod',
      host: '10.30.0.3',
    });
  });

  it('treats empty DATABASE_URL as unset', () => {
    expect(() =>
      resolvePostgresConfig({ DATABASE_URL: '', NODE_ENV: 'test' }),
    ).toThrow(/db:up/);
    expect(() =>
      resolvePostgresConfig({ DATABASE_URL: '   ', NODE_ENV: 'production' }),
    ).toThrow(/CLOUD_SQL_CONNECTION_NAME/);
  });

  it('does not treat NODE_ENV=production as a Postgres signal', () => {
    expect(() => resolvePostgresConfig({ NODE_ENV: 'production' })).toThrow(
      /PostgreSQL is required/,
    );
  });

  it('reads process.env at call time, including Vitest empty DATABASE_URL', () => {
    expect(process.env.DATABASE_URL).toBe('');
    expect(() => resolvePostgresConfig()).toThrow(/db:up/);
  });
});

describe('getDatabase unreachable Postgres', () => {
  const previousUrl = process.env.DATABASE_URL;

  afterEach(async () => {
    await closeDatabase();
    __setTestDatabaseAdapter(null);
    process.env.DATABASE_URL = previousUrl;
  });

  it('wraps a refused DATABASE_URL connection with a db:up hint', async () => {
    const port = await unusedPort();
    process.env.DATABASE_URL = `postgres://colosseum:colosseum@127.0.0.1:${port}/colosseum`;
    __setTestDatabaseAdapter(null);

    await expect(getDatabase()).rejects.toThrow(/npm run db:up/);
  });
});

function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}
