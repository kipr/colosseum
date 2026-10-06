/**
 * TIMESTAMP and DATE columns must read back the same regardless of the Node
 * process's time zone. See POSTGRES_SESSION_OPTIONS in connection.ts.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  closeDatabase,
  getDatabase,
  __setTestDatabaseAdapter,
} from '../../src/server/database/connection';
import { createTestDb, testDatabaseUrl, type TestDb } from './helpers/testDb';
import { withNodeTimeZone } from './helpers/timeZone';
import { seedEvent, seedUser } from '../http/helpers/seed';

const NON_UTC_ZONES = ['America/Chicago', 'Asia/Tokyo'];

describe('app connection pool', () => {
  const previousUrl = process.env.DATABASE_URL;

  afterEach(async () => {
    await closeDatabase();
    __setTestDatabaseAdapter(null);
    process.env.DATABASE_URL = previousUrl;
  });

  it('pins the session to UTC and reads TIMESTAMP as UTC', async () => {
    process.env.DATABASE_URL = testDatabaseUrl();
    __setTestDatabaseAdapter(null);

    await withNodeTimeZone('America/Chicago', async () => {
      const db = await getDatabase();
      const row = await db.get<{ zone: string; now: Date }>(
        `SELECT current_setting('TimeZone') AS zone,
                CURRENT_TIMESTAMP::timestamp AS now`,
      );
      expect(row?.zone).toBe('UTC');
      expect(Math.abs(Date.now() - row!.now.getTime())).toBeLessThan(60_000);
    });
  });
});

describe('timestamp and date parsing', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
  });

  afterEach(() => testDb.close());

  for (const zone of NON_UTC_ZONES) {
    it(`reads CURRENT_TIMESTAMP rows as the current instant in ${zone}`, async () => {
      await withNodeTimeZone(zone, async () => {
        const user = await seedUser(testDb.db);
        await testDb.db.run(
          'UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE id = ?',
          [user.id],
        );
        const row = await testDb.db.get<{ last_activity: Date }>(
          'SELECT last_activity FROM users WHERE id = ?',
          [user.id],
        );
        expect(
          Math.abs(Date.now() - row!.last_activity.getTime()),
        ).toBeLessThan(60_000);
      });
    });

    it(`round-trips a Date parameter in ${zone}`, async () => {
      await withNodeTimeZone(zone, async () => {
        const user = await seedUser(testDb.db);
        const instant = new Date('2026-10-06T12:34:56.000Z');
        await testDb.db.run('UPDATE users SET last_activity = ? WHERE id = ?', [
          instant,
          user.id,
        ]);
        const row = await testDb.db.get<{ last_activity: Date }>(
          'SELECT last_activity FROM users WHERE id = ?',
          [user.id],
        );
        expect(row!.last_activity.toISOString()).toBe(instant.toISOString());
      });
    });

    it(`reads DATE columns as date-only strings in ${zone}`, async () => {
      await withNodeTimeZone(zone, async () => {
        const event = await seedEvent(testDb.db, { event_date: '2026-10-06' });
        const row = await testDb.db.get<{ event_date: unknown }>(
          'SELECT event_date FROM events WHERE id = ?',
          [event.id],
        );
        expect(row?.event_date).toBe('2026-10-06');
      });
    });
  }

  it('parses TIMESTAMP infinity and BC values', async () => {
    const row = await testDb.db.get<{
      pos: Date | number;
      neg: Date | number;
      bc: Date;
    }>(
      `SELECT 'infinity'::timestamp AS pos,
              '-infinity'::timestamp AS neg,
              '0001-01-01 00:00:00 BC'::timestamp AS bc`,
    );
    expect(row?.pos).toBe(Infinity);
    expect(row?.neg).toBe(-Infinity);
    expect(row!.bc.getUTCFullYear()).toBe(0);
    expect(row!.bc.getUTCHours()).toBe(0);
  });
});
