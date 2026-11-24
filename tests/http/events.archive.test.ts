import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  __setTestDatabaseAdapter,
  type Database,
} from '../../src/server/database/connection';
import eventsRoutes from '../../src/server/routes/events';
import { createTestDb, TestDb } from '../sql/helpers/testDb';
import {
  createTestApp,
  http,
  startServer,
  TestServerHandle,
} from './helpers/testServer';
import { seedEvent, seedUser } from './helpers/seed';

type EventRow = Record<string, unknown> & {
  id: number;
  spectator_listing: string;
  season_id: number | null;
};

const invalidPlacements = [
  'archived',
  '',
  null,
  true,
  false,
  0,
  [],
  {},
  ['archive'],
];
const invalidSeasons = [
  '',
  0,
  -1,
  1.5,
  2147483648,
  '2147483648',
  '01',
  '+1',
  '1.0',
  '1e0',
  ' 1',
  '1 ',
  '1junk',
  '1; DROP TABLE events',
  true,
  false,
  [],
  {},
  [1],
];

describe('Event placement writes (PostgreSQL)', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let publicServer: TestServerHandle;
  let adminId: number;
  let seasonA: number;
  let seasonB: number;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    adminId = (await seedUser(testDb.db, { is_admin: true })).id;
    seasonA = (
      await testDb.db.run(
        "INSERT INTO seasons (name) VALUES ('2025–2026') RETURNING id",
      )
    ).lastID!;
    seasonB = (
      await testDb.db.run(
        "INSERT INTO seasons (name) VALUES ('2026') RETURNING id",
      )
    ).lastID!;
    const app = createTestApp({ user: { id: adminId, is_admin: true } });
    app.use('/events', eventsRoutes);
    server = await startServer(app);
    const publicApp = createTestApp();
    publicApp.use('/events', eventsRoutes);
    publicServer = await startServer(publicApp);
  });

  afterEach(async () => {
    await Promise.all([server.close(), publicServer.close()]);
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  const url = (base: string, id?: number) =>
    `${base}/events${id === undefined ? '' : `/${id}`}`;
  async function stored(id: number) {
    return (await testDb.db.get<EventRow>('SELECT * FROM events WHERE id = ?', [
      id,
    ]))!;
  }
  async function assertReadbacks(
    id: number,
    listing: string,
    season: number | null,
  ) {
    const expected = { id, spectator_listing: listing, season_id: season };
    expect(await stored(id)).toMatchObject(expected);
    expect((await http.get(url(server.baseUrl, id))).json).toMatchObject(
      expected,
    );
    const detail = await http.get(`${url(publicServer.baseUrl, id)}/public`);
    expect(detail.status).toBe(200);
    expect(detail.json).toMatchObject({
      ...expected,
      season_name:
        season === seasonA ? '2025–2026' : season === seasonB ? '2026' : null,
    });
  }

  it.each([
    [{}, 'current', null],
    [{ spectator_listing: 'current', season_id: null }, 'current', null],
    [{ season_id: '1' }, 'current', 1],
    [{ spectator_listing: 'archive', season_id: 2 }, 'archive', 2],
  ])(
    'creates with %j and round-trips defaults/metadata',
    async (fields, listing, season) => {
      const res = await http.post<EventRow>(url(server.baseUrl), {
        name: 'Round-trip sentinel',
        ...fields,
      });
      expect(res.status, JSON.stringify(res.json)).toBe(201);
      expect(res.json).toMatchObject({
        spectator_listing: listing,
        season_id: season,
        status: 'setup',
        spectator_results_released: 0,
        created_by: adminId,
      });
      await assertReadbacks(
        res.json.id,
        String(listing),
        season as number | null,
      );
      const audit = await testDb.db.get(
        'SELECT * FROM audit_log WHERE action = ?',
        ['event_created'],
      );
      expect(audit).toMatchObject({ user_id: adminId, entity_id: res.json.id });
      expect(JSON.parse(audit.new_value)).toMatchObject({
        spectator_listing: listing,
        season_id: season,
      });
    },
  );

  it('preserves omitted fields, reuses a season, reassigns it, retains it on return, and clears only explicitly', async () => {
    const created = await http.post<EventRow>(url(server.baseUrl), {
      name: 'Transitions',
      season_id: seasonA,
      status: 'complete',
    });
    const id = created.json.id;
    await testDb.db.run(
      'UPDATE events SET spectator_results_released = 1 WHERE id = ?',
      [id],
    );
    const changes = [
      [{ spectator_listing: 'archive' }, 'archive', seasonA],
      [{ name: 'Unrelated edit' }, 'archive', seasonA],
      [{ season_id: String(seasonB) }, 'archive', seasonB],
      [{ spectator_listing: 'current' }, 'current', seasonB],
      [{ season_id: null }, 'current', null],
      [
        { spectator_listing: 'archive', season_id: seasonA },
        'archive',
        seasonA,
      ],
      [{ spectator_listing: 'current', season_id: null }, 'current', null],
    ] as const;
    for (const [body, listing, season] of changes) {
      const before = await stored(id);
      const res = await http.patch<EventRow>(url(server.baseUrl, id), body);
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      await assertReadbacks(id, listing, season);
      expect(res.json).toMatchObject({
        status: 'complete',
        spectator_results_released: 1,
      });
      const audit = await testDb.db.get(
        'SELECT * FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1',
        ['event_updated'],
      );
      expect(audit).toMatchObject({ user_id: adminId, event_id: id });
      expect(JSON.parse(audit.old_value)).toMatchObject({
        spectator_listing: before.spectator_listing,
        season_id: before.season_id,
        status: 'complete',
        spectator_results_released: 1,
      });
      expect(JSON.parse(audit.new_value)).toMatchObject({
        spectator_listing: listing,
        season_id: season,
        status: 'complete',
        spectator_results_released: 1,
      });
    }
  });

  it.each(['setup', 'active', 'complete', 'archived'])(
    'does not infer lifecycle or release when moving %s',
    async (status) => {
      const event = await seedEvent(testDb.db, {
        status,
        name: `Lifecycle ${status}`,
      });
      await testDb.db.run(
        'UPDATE events SET spectator_results_released = 1 WHERE id = ?',
        [event.id],
      );
      const res = await http.patch<EventRow>(url(server.baseUrl, event.id), {
        spectator_listing: 'archive',
        season_id: seasonA,
      });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({
        status,
        spectator_results_released: 1,
        spectator_listing: 'archive',
        season_id: seasonA,
      });
    },
  );

  it.each([
    { spectator_listing: 'archive' },
    { spectator_listing: 'archive', season_id: null },
    { spectator_listing: 'archive', season_id: 999999 },
  ])('rejects an invalid resulting unseasoned row: %j', async (fields) => {
    const event = await seedEvent(testDb.db, { name: 'Original sentinel' });
    const before = await stored(event.id);
    const res = await http.patch<{ error: string }>(
      url(server.baseUrl, event.id),
      { name: 'Must not persist', ...fields },
    );
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/season/i);
    expect(await stored(event.id)).toEqual(before);
    expect(await testDb.db.all('SELECT * FROM audit_log')).toEqual([]);
    const create = await http.post<{ error: string }>(url(server.baseUrl), {
      name: 'Invalid creation',
      ...fields,
    });
    expect(create.status).toBe(400);
    expect(create.json.error).toMatch(/season/i);
    expect(await testDb.db.all('SELECT id FROM events')).toEqual([
      { id: event.id },
    ]);
  });

  it.each([
    { season_id: null },
    { season_id: null, spectator_listing: 'archive' },
  ])('cannot clear a season while remaining archived: %j', async (fields) => {
    const event = await seedEvent(testDb.db, { name: 'Archive sentinel' });
    await testDb.db.run(
      "UPDATE events SET spectator_listing = 'archive', season_id = ? WHERE id = ?",
      [seasonA, event.id],
    );
    const before = await stored(event.id);
    const res = await http.patch<{ error: string }>(
      url(server.baseUrl, event.id),
      { name: 'Must not persist', ...fields },
    );
    expect(res.status).toBe(400);
    expect(res.json.error).toMatch(/season/i);
    expect(await stored(event.id)).toEqual(before);
    expect(await testDb.db.all('SELECT * FROM audit_log')).toEqual([]);
  });

  it.each([
    ...invalidPlacements.map((value) => ({ spectator_listing: value })),
    ...invalidSeasons.map((value) => ({ season_id: value })),
    { season_id: 999999 },
  ])('rejects hostile fields without partial writes: %j', async (fields) => {
    const event = await seedEvent(testDb.db, { name: 'Untouched sentinel' });
    const before = await stored(event.id);
    const patch = await http.patch<{ error: string }>(
      url(server.baseUrl, event.id),
      { name: 'Must not persist', ...fields },
    );
    expect(patch.status, JSON.stringify(patch.json)).toBe(400);
    expect(patch.json.error).toMatch(/spectator_listing|season_id|season/i);
    expect(await stored(event.id)).toEqual(before);
    const create = await http.post<{ error: string }>(url(server.baseUrl), {
      name: 'Must not be created',
      ...fields,
    });
    expect(create.status, JSON.stringify(create.json)).toBe(400);
    expect(create.json.error).toMatch(/spectator_listing|season_id|season/i);
    expect(await testDb.db.all('SELECT id FROM events')).toEqual([
      { id: event.id },
    ]);
    expect(await testDb.db.all('SELECT * FROM audit_log')).toEqual([]);
  });

  it.each(['anonymous', 'non-admin', 'judge'])(
    'rejects forged event mutations from %s',
    async (role) => {
      const user = await seedUser(testDb.db, {
        google_id: role,
        email: `${role}@example.com`,
      });
      const event = await seedEvent(testDb.db, {
        name: 'Authorization sentinel',
      });
      const before = await stored(event.id);
      const app = createTestApp(
        role === 'non-admin'
          ? { user: { id: user.id, is_admin: false } }
          : role === 'judge'
            ? {
                judgeSession: {
                  templateId: 1,
                  eventIds: [event.id],
                  conversationKey: 'judge-key',
                  issuedAt: Date.now(),
                  expiresAt: Date.now() + 60000,
                },
              }
            : {},
      );
      app.use('/events', eventsRoutes);
      const denied = await startServer(app);
      try {
        const body = {
          name: 'Forged',
          spectator_listing: 'archive',
          season_id: seasonA,
          is_admin: true,
          created_by: adminId,
          status: 'complete',
          spectator_results_released: 1,
        };
        expect((await http.post(url(denied.baseUrl), body)).status).toBe(403);
        expect(
          (await http.patch(url(denied.baseUrl, event.id), body)).status,
        ).toBe(403);
        expect(await stored(event.id)).toEqual(before);
        expect(await testDb.db.all('SELECT id FROM events')).toEqual([
          { id: event.id },
        ]);
        expect(await testDb.db.all('SELECT * FROM audit_log')).toEqual([]);
      } finally {
        await denied.close();
      }
    },
  );

  it('rolls back the entire write on a database persistence failure, with no successful audit', async () => {
    const event = await seedEvent(testDb.db, { name: 'Failure sentinel' });
    await testDb.db.run('UPDATE events SET season_id = ? WHERE id = ?', [
      seasonA,
      event.id,
    ]);
    const before = await stored(event.id);
    await testDb.db
      .exec(`CREATE FUNCTION reject_archive_write() RETURNS trigger AS $$
      BEGIN
        IF NEW.spectator_listing = 'archive' AND NEW.season_id = ${seasonB} THEN
          RAISE EXCEPTION 'injected persistence failure';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_archive_write BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION reject_archive_write();`);
    try {
      const res = await http.patch(url(server.baseUrl, event.id), {
        name: 'Must not persist',
        spectator_listing: 'archive',
        season_id: seasonB,
      });
      expect(res.status).toBe(500);
      expect(await stored(event.id)).toEqual(before);
      expect(await testDb.db.all('SELECT * FROM audit_log')).toEqual([]);
    } finally {
      await testDb.db.exec(
        'DROP TRIGGER reject_archive_write ON events; DROP FUNCTION reject_archive_write();',
      );
    }
  });

  it('retains the existing post-write audit-failure policy', async () => {
    const event = await seedEvent(testDb.db);
    await testDb.db
      .exec(`CREATE FUNCTION reject_event_audit() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_event_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_event_audit();`);
    try {
      const res = await http.patch(url(server.baseUrl, event.id), {
        spectator_listing: 'archive',
        season_id: seasonA,
      });
      expect(res.status).toBe(500);
      expect(await stored(event.id)).toMatchObject({
        spectator_listing: 'archive',
        season_id: seasonA,
      });
      expect(await testDb.db.all('SELECT * FROM audit_log')).toEqual([]);
    } finally {
      await testDb.db.exec(
        'DROP TRIGGER reject_event_audit ON audit_log; DROP FUNCTION reject_event_audit();',
      );
    }
  });

  it('serializes concurrent resulting-row checks and audits actual snapshots without overwriting independent edits', async () => {
    const event = await seedEvent(testDb.db);
    await testDb.db.run('UPDATE events SET season_id = ? WHERE id = ?', [
      seasonA,
      event.id,
    ]);
    const before = JSON.parse(JSON.stringify(await stored(event.id)));

    function latch() {
      let open!: () => void;
      const promise = new Promise<void>((resolve) => {
        open = resolve;
      });
      return { promise, open: () => open() };
    }
    async function interleave(firstBody: unknown, secondBody: unknown) {
      const locked = latch();
      const secondAttempted = latch();
      const release = latch();
      let reads = 0;
      const db = testDb.db;
      const controlled: Database = {
        get: db.get.bind(db),
        all: db.all.bind(db),
        run: db.run.bind(db),
        exec: db.exec.bind(db),
        transaction: (fn) =>
          db.transaction((tx) =>
            fn({
              ...tx,
              get: async (sql, params) => {
                if (!sql.startsWith('SELECT * FROM events WHERE id = ?'))
                  return tx.get(sql, params);
                const index = reads++;
                if (index === 1) secondAttempted.open();
                const row = await tx.get(sql, params);
                if (index === 0) {
                  locked.open();
                  await release.promise;
                }
                return row;
              },
            }),
          ),
      };
      __setTestDatabaseAdapter(controlled);
      const first = http.patch<EventRow>(
        url(server.baseUrl, event.id),
        firstBody,
      );
      let second: ReturnType<typeof http.patch<EventRow>> | undefined;
      try {
        await locked.promise;
        // Prove the first request really holds a PostgreSQL row lock while paused.
        await expect(
          db.transaction((tx) =>
            tx.get('SELECT id FROM events WHERE id = ? FOR UPDATE NOWAIT', [
              event.id,
            ]),
          ),
        ).rejects.toMatchObject({ code: '55P03' });
        second = http.patch<EventRow>(
          url(server.baseUrl, event.id),
          secondBody,
        );
        await secondAttempted.promise;
        release.open();
        return await Promise.all([first, second]);
      } finally {
        release.open();
        await Promise.allSettled([first, ...(second ? [second] : [])]);
        __setTestDatabaseAdapter(db);
      }
    }

    const responses = await interleave(
      { status: 'complete', spectator_results_released: 1, season_id: seasonB },
      { spectator_listing: 'archive' },
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(await stored(event.id)).toMatchObject({
      spectator_listing: 'archive',
      season_id: seasonB,
      status: 'complete',
      spectator_results_released: 1,
    });
    const audits = await testDb.db.all(
      'SELECT * FROM audit_log WHERE action = ?',
      ['event_updated'],
    );
    expect(audits).toHaveLength(2);
    // Audits run after commit, so identify each mutation by content, not audit ID.
    const firstAudit = audits.find(
      (row) => JSON.parse(row.new_value).spectator_listing === 'current',
    );
    const secondAudit = audits.find(
      (row) => JSON.parse(row.new_value).spectator_listing === 'archive',
    );
    expect(firstAudit).toMatchObject({ user_id: adminId });
    expect(secondAudit).toMatchObject({ user_id: adminId });
    expect(JSON.parse(firstAudit.old_value)).toEqual(before);
    expect(JSON.parse(firstAudit.new_value)).toEqual(responses[0].json);
    expect(JSON.parse(secondAudit.old_value)).toEqual(responses[0].json);
    expect(JSON.parse(secondAudit.new_value)).toEqual(responses[1].json);

    await http.patch(url(server.baseUrl, event.id), {
      spectator_listing: 'current',
    });
    const conflicting = await interleave(
      { spectator_listing: 'archive' },
      { season_id: null },
    );
    expect(conflicting.map((r) => r.status)).toEqual([200, 400]);
    expect(conflicting[1].json).toEqual({
      error: 'A season is required for archive placement',
    });
    expect(await stored(event.id)).toMatchObject({
      spectator_listing: 'archive',
      season_id: seasonB,
      status: 'complete',
      spectator_results_released: 1,
    });
    expect(
      await testDb.db.all('SELECT * FROM audit_log WHERE action = ?', [
        'event_updated',
      ]),
    ).toHaveLength(4);
  });
});
