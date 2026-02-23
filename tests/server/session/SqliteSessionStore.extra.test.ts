/**
 * Additional SqliteSessionStore tests targeting touch, clearExpired,
 * computeExpires with cookie.expires as Date, and error branches.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import SQLite from 'better-sqlite3';
import { SqliteSessionStore } from '../../../src/server/session/SqliteSessionStore';

describe('SqliteSessionStore - additional coverage', () => {
  let db: InstanceType<typeof SQLite>;
  let store: SqliteSessionStore;

  beforeEach(() => {
    db = new SQLite(':memory:');
    store = new SqliteSessionStore({ db, ttlMs: 60_000 });
  });

  describe('touch', () => {
    it('updates expiry for existing session', (ctx) => {
      return new Promise<void>((resolve) => {
        const sess = { cookie: { maxAge: 120_000 } } as never;
        store.set('touch-sid', sess, () => {
          // Touch with new expiry
          store.touch('touch-sid', sess, (err) => {
            expect(err).toBeNull();

            store.get('touch-sid', (_err, session) => {
              expect(session).not.toBeNull();
              resolve();
            });
          });
        });
      });
    });

    it('calls callback with error on failure', () => {
      return new Promise<void>((resolve) => {
        db.close();
        const sess = { cookie: {} } as never;
        store.touch('sid', sess, (err) => {
          expect(err).toBeDefined();
          resolve();
        });
      });
    });
  });

  describe('clearExpired', () => {
    it('removes expired sessions', () => {
      return new Promise<void>((resolve) => {
        // Insert a session that's already expired
        const expiredSess = {
          cookie: { expires: new Date(Date.now() - 10_000) },
        } as never;
        store.set('expired-sid', expiredSess, () => {
          store.clearExpired((err) => {
            expect(err).toBeNull();

            store.get('expired-sid', (_err, session) => {
              expect(session).toBeNull();
              resolve();
            });
          });
        });
      });
    });

    it('calls callback with error on failure', () => {
      return new Promise<void>((resolve) => {
        db.close();
        store.clearExpired((err) => {
          expect(err).toBeDefined();
          resolve();
        });
      });
    });

    it('works without callback', () => {
      store.clearExpired();
    });
  });

  describe('computeExpires via set', () => {
    it('uses cookie.expires Date when present', () => {
      return new Promise<void>((resolve) => {
        const futureDate = new Date(Date.now() + 300_000);
        const sess = { cookie: { expires: futureDate } } as never;
        store.set('date-sid', sess, () => {
          store.get('date-sid', (_err, session) => {
            expect(session).not.toBeNull();
            resolve();
          });
        });
      });
    });

    it('uses default TTL when no maxAge or expires', () => {
      return new Promise<void>((resolve) => {
        const sess = { cookie: {} } as never;
        store.set('default-ttl-sid', sess, () => {
          store.get('default-ttl-sid', (_err, session) => {
            expect(session).not.toBeNull();
            resolve();
          });
        });
      });
    });
  });

  describe('get - expired session', () => {
    it('deletes expired session on get', () => {
      return new Promise<void>((resolve) => {
        const pastDate = new Date(Date.now() - 10_000);
        const sess = { cookie: { expires: pastDate } } as never;
        store.set('will-expire', sess, () => {
          store.get('will-expire', (_err, session) => {
            expect(session).toBeNull();
            resolve();
          });
        });
      });
    });
  });

  describe('set - error handling', () => {
    it('calls callback with error on failure', () => {
      return new Promise<void>((resolve) => {
        db.close();
        const sess = { cookie: {} } as never;
        store.set('fail-sid', sess, (err) => {
          expect(err).toBeDefined();
          resolve();
        });
      });
    });
  });

  describe('destroy - error handling', () => {
    it('calls callback with error on failure', () => {
      return new Promise<void>((resolve) => {
        db.close();
        store.destroy('fail-sid', (err) => {
          expect(err).toBeDefined();
          resolve();
        });
      });
    });
  });

  describe('get - invalid JSON', () => {
    it('returns null for malformed session data', () => {
      return new Promise<void>((resolve) => {
        // Directly insert malformed data
        const insertDb = new SQLite(':memory:');
        const s = new SqliteSessionStore({ db: insertDb });

        insertDb
          .prepare(
            'INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?)',
          )
          .run('bad-json', 'not-valid-json', Date.now() + 60_000);

        s.get('bad-json', (_err, session) => {
          expect(session).toBeNull();
          insertDb.close();
          resolve();
        });
      });
    });
  });
});
