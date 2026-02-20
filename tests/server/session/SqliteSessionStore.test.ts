import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SQLite from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import type session from 'express-session';
import { SqliteSessionStore } from '../../../src/server/session/SqliteSessionStore';

function getSession(
  store: SqliteSessionStore,
  sid: string,
): Promise<session.SessionData | null> {
  return new Promise((resolve, reject) => {
    store.get(sid, (err, sess) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(sess ?? null);
    });
  });
}

describe('SqliteSessionStore', () => {
  let db: BetterSqliteDatabase;
  let store: SqliteSessionStore;

  beforeEach(() => {
    db = new SQLite(':memory:');
    store = new SqliteSessionStore({ db, ttlMs: 1000 });
  });

  afterEach(() => {
    db.close();
  });

  it('sets and gets a session payload', async () => {
    const sessionData = { cookie: {}, userId: 42 } as session.SessionData;
    store.set('sid-1', sessionData);

    const loaded = await getSession(store, 'sid-1');
    expect(loaded).not.toBeNull();
    expect(loaded?.userId).toBe(42);
  });

  it('returns null and deletes row when session is expired', async () => {
    db.prepare(`INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)`).run(
      'expired-sid',
      JSON.stringify({ cookie: {}, userId: 7 }),
      Date.now() - 1,
    );

    const loaded = await getSession(store, 'expired-sid');
    expect(loaded).toBeNull();

    const row = db
      .prepare(`SELECT sid FROM sessions WHERE sid = ?`)
      .get('expired-sid');
    expect(row).toBeUndefined();
  });

  it('returns null for invalid JSON session rows', async () => {
    db.prepare(`INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)`).run(
      'bad-json',
      '{not-json',
      Date.now() + 60_000,
    );

    const loaded = await getSession(store, 'bad-json');
    expect(loaded).toBeNull();
  });

  it('uses cookie.expires timestamp when setting session expiry', () => {
    const expires = new Date(Date.now() + 5000);
    const sessionData = { cookie: { expires } } as session.SessionData;

    store.set('sid-exp', sessionData);

    const row = db
      .prepare(`SELECT expires FROM sessions WHERE sid = ?`)
      .get('sid-exp') as { expires: number };
    expect(row.expires).toBe(expires.getTime());
  });

  it('touch updates expiry and clearExpired removes expired sessions', () => {
    store.set('sid-active', { cookie: { maxAge: 90_000 } } as session.SessionData);

    db.prepare(`INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)`).run(
      'sid-old',
      JSON.stringify({ cookie: {} }),
      Date.now() - 10_000,
    );

    store.clearExpired();
    store.touch(
      'sid-active',
      { cookie: { maxAge: 120_000 } } as session.SessionData,
    );

    const expiredRow = db
      .prepare(`SELECT sid FROM sessions WHERE sid = ?`)
      .get('sid-old');
    expect(expiredRow).toBeUndefined();

    const activeRow = db
      .prepare(`SELECT expires FROM sessions WHERE sid = ?`)
      .get('sid-active') as { expires: number };
    expect(activeRow.expires).toBeGreaterThan(Date.now());
  });
});
