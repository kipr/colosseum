import session from 'express-session';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';

type SessionData = session.SessionData;

export interface SqliteSessionStoreOptions {
  db: BetterSqliteDatabase;
  tableName?: string;
  ttlMs?: number; // default: 7 days
}

function safeJsonParse<T>(s: string): T | null {
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export class SqliteSessionStore extends session.Store {
  private db: BetterSqliteDatabase;
  private table: string;
  private ttlMs: number;

  // Prepared statements
  private stmtGet;
  private stmtSet;
  private stmtDestroy;
  private stmtTouch;
  private stmtClearExpired;

  constructor(opts: SqliteSessionStoreOptions) {
    super();
    this.db = opts.db;
    this.table = opts.tableName ?? 'sessions';
    this.ttlMs = opts.ttlMs ?? 7 * 24 * 60 * 60 * 1000;

    // Create table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.table} (
        sid TEXT PRIMARY KEY,
        sess TEXT NOT NULL,
        expires INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_${this.table}_expires ON ${this.table} (expires);
    `);

    // Prepare statements once (fast + reliable)
    this.stmtGet = this.db.prepare(
      `SELECT sess, expires FROM ${this.table} WHERE sid = ? LIMIT 1`,
    );
    this.stmtSet = this.db.prepare(
      `INSERT INTO ${this.table} (sid, sess, expires)
       VALUES (?, ?, ?)
       ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires`,
    );
    this.stmtDestroy = this.db.prepare(
      `DELETE FROM ${this.table} WHERE sid = ?`,
    );
    this.stmtTouch = this.db.prepare(
      `UPDATE ${this.table} SET expires = ? WHERE sid = ?`,
    );
    this.stmtClearExpired = this.db.prepare(
      `DELETE FROM ${this.table} WHERE expires IS NOT NULL AND expires <= ?`,
    );
  }

  // express-session expects: cb(err, session|null)
  get(
    sid: string,
    cb: (err?: Error | null, session?: SessionData | null) => void,
  ): void {
    try {
      const row = this.stmtGet.get(sid) as
        | { sess: string; expires: number | null }
        | undefined;
      if (!row) return cb(null, null);

      // If expired, delete and treat as missing.
      if (row.expires != null && row.expires <= Date.now()) {
        this.stmtDestroy.run(sid);
        return cb(null, null);
      }

      const parsed = safeJsonParse<SessionData>(row.sess);
      if (!parsed) return cb(null, null);

      return cb(null, parsed);
    } catch (err) {
      return cb(err instanceof Error ? err : new Error(String(err)));
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  set(sid: string, sess: SessionData, cb?: (err?: any) => void): void {
    try {
      const expires = this.computeExpires(sess);
      this.stmtSet.run(sid, JSON.stringify(sess), expires);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  destroy(sid: string, cb?: (err?: any) => void): void {
    try {
      this.stmtDestroy.run(sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  touch(sid: string, sess: SessionData, cb?: (err?: any) => void): void {
    try {
      const expires = this.computeExpires(sess);
      this.stmtTouch.run(expires, sid);
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  // Optional but helpful: clean expired sessions periodically
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  clearExpired(cb?: (err?: any) => void): void {
    try {
      this.stmtClearExpired.run(Date.now());
      cb?.(null);
    } catch (err) {
      cb?.(err);
    }
  }

  private computeExpires(sess: SessionData): number | null {
    // express-session stores cookie.expires as Date or undefined.
    const cookieExpires = sess.cookie?.expires;
    if (cookieExpires instanceof Date) return cookieExpires.getTime();

    // Otherwise derive from cookie.maxAge if available, else default TTL.
    const maxAge = sess.cookie?.maxAge;
    const ttl = typeof maxAge === 'number' ? maxAge : this.ttlMs;
    return Date.now() + ttl;
  }
}
