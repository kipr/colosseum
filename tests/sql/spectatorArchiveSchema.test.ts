import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../../src/server/database/connection';
import { initializePostgres } from '../../src/server/database/init';
import { runSchema } from '../../src/server/database/schema';
import { usersSchema } from '../../src/server/database/schema/users';
import {
  createMinimalTestDb,
  createTestDb,
  type TestDb,
} from './helpers/testDb';

const statuses = ['setup', 'active', 'complete', 'archived'] as const;

// Keep the pre-feature event definition independent of the production module:
// initializing the latest schema first would not exercise the upgrade path.
async function createLegacyEvents(db: Database): Promise<void> {
  await runSchema(db, [usersSchema]);
  await db.exec(`
    CREATE TABLE events (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      event_date DATE,
      location TEXT,
      status TEXT NOT NULL DEFAULT 'setup'
        CHECK (status IN ('setup', 'active', 'complete', 'archived')),
      seeding_rounds INTEGER DEFAULT 3,
      double_seeding_rounds INTEGER DEFAULT 0,
      min_rest_minutes INTEGER NOT NULL DEFAULT 3 CHECK (min_rest_minutes >= 0),
      score_accept_mode TEXT NOT NULL DEFAULT 'manual'
        CHECK (score_accept_mode IN ('manual', 'auto_accept_seeding', 'auto_accept_all')),
      spectator_results_released INTEGER NOT NULL DEFAULT 0,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function insertSeason(db: Database, name = '2025–2026'): Promise<number> {
  const result = await db.run(
    'INSERT INTO seasons (name) VALUES (?) RETURNING id',
    [name],
  );
  return result.lastID!;
}

async function insertArchiveEvent(
  db: Database,
  seasonId: number,
): Promise<number> {
  const result = await db.run(
    `INSERT INTO events
      (name, description, status, spectator_results_released, spectator_listing, season_id)
     VALUES ('Archive sentinel', 'Preserve this description', 'complete', 1, 'archive', ?)
     RETURNING id`,
    [seasonId],
  );
  return result.lastID!;
}

describe.each(['fresh', 'upgraded'] as const)(
  'spectator placement and seasons (%s schema)',
  (schemaPath) => {
    let testDb: TestDb;
    let db: Database;

    beforeAll(async () => {
      testDb =
        schemaPath === 'fresh'
          ? await createTestDb()
          : await createMinimalTestDb();
      db = testDb.db;
      if (schemaPath === 'upgraded') {
        await createLegacyEvents(db);
        await initializePostgres(db);
      }
    });

    beforeEach(async () => {
      await db.exec('TRUNCATE seasons, events RESTART IDENTITY CASCADE');
    });

    afterAll(() => {
      testDb?.close();
    });

    it('persists current placement and no season when both fields are omitted', async () => {
      const event = await db.run(
        "INSERT INTO events (name) VALUES ('Default sentinel') RETURNING id",
      );
      expect(
        await db.get(
          `SELECT id, name, status, spectator_results_released, spectator_listing, season_id
           FROM events WHERE id = ?`,
          [event.lastID],
        ),
      ).toEqual({
        id: event.lastID,
        name: 'Default sentinel',
        status: 'setup',
        spectator_results_released: 0,
        spectator_listing: 'current',
        season_id: null,
      });
    });

    it.each(statuses)(
      'allows all valid placement/season combinations independently of %s status and release state',
      async (status) => {
        const seasonId = await insertSeason(db);
        for (const released of [0, 1]) {
          for (const [listing, assignedSeason] of [
            ['current', null],
            ['current', seasonId],
            ['archive', seasonId],
          ] as const) {
            const name = `${status}-${released}-${listing}-${assignedSeason}`;
            const event = await db.run(
              `INSERT INTO events
                (name, status, spectator_results_released, spectator_listing, season_id)
               VALUES (?, ?, ?, ?, ?) RETURNING id`,
              [name, status, released, listing, assignedSeason],
            );
            expect(
              await db.get(
                `SELECT name, status, spectator_results_released, spectator_listing, season_id
                 FROM events WHERE id = ?`,
                [event.lastID],
              ),
            ).toEqual({
              name,
              status,
              spectator_results_released: released,
              spectator_listing: listing,
              season_id: assignedSeason,
            });
          }
        }
      },
    );

    it.each([
      [null, '23502'],
      ['', '23514'],
      ['archived', '23514'],
      ['unknown', '23514'],
      ['CURRENT', '23514'],
    ])(
      'rejects placement %s on insert and atomic update',
      async (listing, code) => {
        const seasonId = await insertSeason(db);
        const eventId = await insertArchiveEvent(db, seasonId);
        const before = await db.get('SELECT * FROM events WHERE id = ?', [
          eventId,
        ]);

        await expect(
          db.run(
            'INSERT INTO events (name, spectator_listing, season_id) VALUES (?, ?, ?)',
            ['Invalid placement', listing, seasonId],
          ),
        ).rejects.toMatchObject({ code });
        await expect(
          db.run(
            `UPDATE events SET name = 'Must not persist', status = 'active',
            spectator_results_released = 0, spectator_listing = ? WHERE id = ?`,
            [listing, eventId],
          ),
        ).rejects.toMatchObject({ code });
        expect(
          await db.get('SELECT * FROM events WHERE id = ?', [eventId]),
        ).toEqual(before);
        expect(await db.all('SELECT id FROM events')).toEqual([
          { id: eventId },
        ]);
      },
    );

    it.each(['current', 'archive'])(
      'rejects nonexistent season references for %s inserts and updates',
      async (listing) => {
        const seasonId = await insertSeason(db);
        const eventId = await insertArchiveEvent(db, seasonId);
        const before = await db.get('SELECT * FROM events WHERE id = ?', [
          eventId,
        ]);
        await expect(
          db.run(
            'INSERT INTO events (name, spectator_listing, season_id) VALUES (?, ?, ?)',
            ['Missing season', listing, seasonId + 1000],
          ),
        ).rejects.toMatchObject({ code: '23503' });
        await expect(
          db.run(
            `UPDATE events SET name = 'Must not persist', spectator_listing = ?, season_id = ?
             WHERE id = ?`,
            [listing, seasonId + 1000, eventId],
          ),
        ).rejects.toMatchObject({ code: '23503' });
        expect(
          await db.get('SELECT * FROM events WHERE id = ?', [eventId]),
        ).toEqual(before);
      },
    );

    it('requires a season for archive inserts and placement-only updates', async () => {
      await expect(
        db.run(
          "INSERT INTO events (name, spectator_listing) VALUES ('Seasonless archive', 'archive')",
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const event = await db.run(
        "INSERT INTO events (name) VALUES ('Unseasoned current') RETURNING id",
      );
      const before = await db.get('SELECT * FROM events WHERE id = ?', [
        event.lastID,
      ]);
      await expect(
        db.run(
          "UPDATE events SET spectator_listing = 'archive', description = 'Must not persist' WHERE id = ?",
          [event.lastID],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      expect(
        await db.get('SELECT * FROM events WHERE id = ?', [event.lastID]),
      ).toEqual(before);
    });

    it('rejects clearing an archive season unless the same write returns it to current', async () => {
      const seasonId = await insertSeason(db);
      const eventId = await insertArchiveEvent(db, seasonId);
      const before = await db.get('SELECT * FROM events WHERE id = ?', [
        eventId,
      ]);
      await expect(
        db.run(
          "UPDATE events SET season_id = NULL, name = 'Must not persist' WHERE id = ?",
          [eventId],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      expect(
        await db.get('SELECT * FROM events WHERE id = ?', [eventId]),
      ).toEqual(before);
      await db.run(
        "UPDATE events SET spectator_listing = 'current', season_id = NULL WHERE id = ?",
        [eventId],
      );
      expect(
        await db.get('SELECT * FROM events WHERE id = ?', [eventId]),
      ).toEqual({
        ...before,
        spectator_listing: 'current',
        season_id: null,
        updated_at: expect.any(Date),
      });
    });

    it('moves seasoned events both ways without changing lifecycle or release state and retains an omitted season', async () => {
      const seasonA = await insertSeason(db, '2026');
      const seasonB = await insertSeason(db, '2025–2026');
      for (const status of statuses) {
        for (const released of [0, 1]) {
          const event = await db.run(
            `INSERT INTO events (name, status, spectator_results_released, season_id)
             VALUES (?, ?, ?, ?) RETURNING id`,
            [`Move ${status}-${released}`, status, released, seasonA],
          );
          const before = await db.get('SELECT * FROM events WHERE id = ?', [
            event.lastID,
          ]);
          for (const [listing, seasonId] of [
            ['archive', seasonA],
            ['archive', seasonB],
            ['current', seasonB],
          ]) {
            if (listing === 'current') {
              await db.run(
                "UPDATE events SET spectator_listing = 'current' WHERE id = ?",
                [event.lastID],
              );
            } else {
              await db.run(
                'UPDATE events SET spectator_listing = ?, season_id = ? WHERE id = ?',
                [listing, seasonId, event.lastID],
              );
            }
            expect(
              await db.get('SELECT * FROM events WHERE id = ?', [event.lastID]),
            ).toEqual({
              ...before,
              spectator_listing: listing,
              season_id: seasonId,
              updated_at: expect.any(Date),
            });
          }
        }
      }
    });

    it('keeps calendar dates independent of placement, season, lifecycle and release', async () => {
      const dates = [
        '1999-01-01',
        '2099-12-31',
        null,
        '2025-12-31',
        '2026-01-01',
      ];
      for (const [index, date] of dates.entries()) {
        const status = statuses[index % statuses.length];
        const released = index % 2;
        const event = await db.run(
          `INSERT INTO events (name, event_date, status, spectator_results_released)
           VALUES (?, ?, ?, ?) RETURNING id`,
          [`Date sentinel ${index}`, date, status, released],
        );
        expect(
          await db.get(
            `SELECT name, event_date, status, spectator_results_released, spectator_listing, season_id
             FROM events WHERE id = ?`,
            [event.lastID],
          ),
        ).toEqual({
          name: `Date sentinel ${index}`,
          event_date: date,
          status,
          spectator_results_released: released,
          spectator_listing: 'current',
          season_id: null,
        });
      }
      expect(await db.all('SELECT * FROM seasons')).toEqual([]);
    });

    it('preserves distinct named seasons, display case and internal whitespace', async () => {
      for (const name of ['2026', '2025–2026', 'Spring  Finals']) {
        await insertSeason(db, name);
      }
      expect(
        await db.all('SELECT name, sort_order FROM seasons ORDER BY id'),
      ).toEqual([
        { name: '2026', sort_order: 0 },
        { name: '2025–2026', sort_order: 0 },
        { name: 'Spring  Finals', sort_order: 0 },
      ]);
    });

    it('enforces case-insensitive name uniqueness on insert and update', async () => {
      const seasonId = await insertSeason(db, 'Spring Finals');
      for (const duplicate of [
        'Spring Finals',
        'spring finals',
        'SPRING FINALS',
      ]) {
        await expect(insertSeason(db, duplicate)).rejects.toMatchObject({
          code: '23505',
        });
      }
      const otherId = await insertSeason(db, '2026');
      await expect(
        db.run('UPDATE seasons SET name = ? WHERE id = ?', [
          'spring finals',
          otherId,
        ]),
      ).rejects.toMatchObject({ code: '23505' });
      expect(await db.all('SELECT id, name FROM seasons ORDER BY id')).toEqual([
        { id: seasonId, name: 'Spring Finals' },
        { id: otherId, name: '2026' },
      ]);
    });

    it.each([
      [null, '23502'],
      ['', '23514'],
      [' ', '23514'],
      ['\t\n\r', '23514'],
      [' 2026', '23514'],
      ['2026 ', '23514'],
      ['\t2026', '23514'],
      ['2026\n', '23514'],
      ['x'.repeat(101), '23514'],
    ])(
      'rejects invalid season name %j without normalizing it',
      async (name, code) => {
        const seasonId = await insertSeason(db);
        const before = await db.get('SELECT * FROM seasons WHERE id = ?', [
          seasonId,
        ]);
        await expect(insertSeason(db, name as string)).rejects.toMatchObject({
          code,
        });
        await expect(
          db.run('UPDATE seasons SET name = ? WHERE id = ?', [name, seasonId]),
        ).rejects.toMatchObject({ code });
        expect(
          await db.get('SELECT * FROM seasons WHERE id = ?', [seasonId]),
        ).toEqual(before);
      },
    );

    it('accepts season names at both character-length boundaries, including Unicode', async () => {
      const names = ['A', 'x'.repeat(100), 'é'.repeat(100)];
      for (const name of names) await insertSeason(db, name);
      expect(await db.all('SELECT name FROM seasons ORDER BY id')).toEqual(
        names.map((name) => ({ name })),
      );
      await expect(insertSeason(db, 'é'.repeat(101))).rejects.toMatchObject({
        code: '23514',
      });
    });

    it('uses a non-null signed 32-bit integer sort order defaulting to zero', async () => {
      expect(
        await db.get(
          `SELECT data_type, is_nullable, column_default FROM information_schema.columns
           WHERE table_schema = current_schema() AND table_name = 'seasons'
             AND column_name = 'sort_order'`,
        ),
      ).toEqual({
        data_type: 'integer',
        is_nullable: 'NO',
        column_default: '0',
      });
      const defaultId = await insertSeason(db);
      for (const sortOrder of [-2147483648, -1, 0, 2147483647]) {
        await db.run('INSERT INTO seasons (name, sort_order) VALUES (?, ?)', [
          `Order ${sortOrder}`,
          sortOrder,
        ]);
      }
      expect(
        await db.all('SELECT name, sort_order FROM seasons ORDER BY id'),
      ).toEqual([
        { name: '2025–2026', sort_order: 0 },
        ...[-2147483648, -1, 0, 2147483647].map((sortOrder) => ({
          name: `Order ${sortOrder}`,
          sort_order: sortOrder,
        })),
      ]);
      for (const [invalid, code] of [
        [null, '23502'],
        [-2147483649, '22003'],
        [2147483648, '22003'],
        [1.5, '22P02'],
        ['not-an-integer', '22P02'],
      ]) {
        await expect(
          db.run('UPDATE seasons SET sort_order = ? WHERE id = ?', [
            invalid,
            defaultId,
          ]),
        ).rejects.toMatchObject({ code });
      }
      expect(
        await db.get('SELECT sort_order FROM seasons WHERE id = ?', [
          defaultId,
        ]),
      ).toEqual({
        sort_order: 0,
      });
    });

    it.each(['current', 'archive'])(
      'restricts deletion of a season referenced by a %s event without deleting or mutating either row',
      async (listing) => {
        const seasonId = await insertSeason(db);
        const unusedId = await insertSeason(db, 'Unused');
        const eventId = await insertArchiveEvent(db, seasonId);
        await db.run('UPDATE events SET spectator_listing = ? WHERE id = ?', [
          listing,
          eventId,
        ]);
        const before = await db.get('SELECT * FROM events WHERE id = ?', [
          eventId,
        ]);
        await expect(
          db.run('DELETE FROM seasons WHERE id = ?', [seasonId]),
        ).rejects.toMatchObject({
          code: '23001',
        });
        expect(
          await db.get('SELECT * FROM events WHERE id = ?', [eventId]),
        ).toEqual(before);
        await db.run('DELETE FROM seasons WHERE id = ?', [unusedId]);
        expect(await db.all('SELECT id, name FROM seasons')).toEqual([
          { id: seasonId, name: '2025–2026' },
        ]);
      },
    );

    it('preserves assignments, sort orders and constraints when initialization is rerun', async () => {
      const seasonId = await insertSeason(db);
      await db.run('UPDATE seasons SET sort_order = -7 WHERE id = ?', [
        seasonId,
      ]);
      const eventId = await insertArchiveEvent(db, seasonId);
      const before = await db.get('SELECT * FROM events WHERE id = ?', [
        eventId,
      ]);
      await initializePostgres(db);
      await initializePostgres(db);
      expect(
        await db.get('SELECT * FROM events WHERE id = ?', [eventId]),
      ).toEqual(before);
      expect(await db.all('SELECT id, name, sort_order FROM seasons')).toEqual([
        { id: seasonId, name: '2025–2026', sort_order: -7 },
      ]);
      await expect(
        db.run('UPDATE events SET season_id = NULL WHERE id = ?', [eventId]),
      ).rejects.toMatchObject({
        code: '23514',
      });
      await expect(insertSeason(db)).rejects.toMatchObject({ code: '23505' });
    });
  },
);

describe('pre-feature event migration', () => {
  it('adds current placement and no season without inferring from dates, status or release', async () => {
    const testDb = await createMinimalTestDb();
    const { db } = testDb;
    try {
      await createLegacyEvents(db);
      const creator = await db.run(
        "INSERT INTO users (google_id, email) VALUES ('legacy-admin', 'legacy@example.org') RETURNING id",
      );
      for (const [index, status] of statuses.entries()) {
        for (const released of [0, 1]) {
          await db.run(
            `INSERT INTO events
              (name, description, event_date, location, status, spectator_results_released, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              `Legacy ${status}-${released}`,
              `Legacy description ${index}-${released}`,
              ['1999-01-01', '2099-12-31', null, '2025-12-31'][index],
              `Legacy location ${index}`,
              status,
              released,
              creator.lastID,
            ],
          );
        }
      }
      const before = await db.all('SELECT * FROM events ORDER BY id');
      await initializePostgres(db);
      expect(await db.all('SELECT * FROM events ORDER BY id')).toEqual(
        before.map((event) => ({
          ...event,
          spectator_listing: 'current',
          season_id: null,
        })),
      );
      expect(await db.all('SELECT * FROM seasons')).toEqual([]);
    } finally {
      testDb.close();
    }
  });
});
