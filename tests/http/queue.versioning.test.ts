/**
 * HTTP tests for queue versioning: version-based ETags, 304 responses to
 * conditional polls, version bumps on mutations, and dirty-flag repair syncs.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../src/server/database/connection';
import {
  createTestApp,
  startServer,
  TestServerHandle,
  http,
} from './helpers/testServer';
import { seedEvent, seedTeam, seedQueueItem } from './helpers/seed';
import queueRoutes from '../../src/server/routes/queue';

describe('Queue versioning and conditional polling', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const app = createTestApp({ user: { id: 1, is_admin: false } });
    app.use('/queue', queueRoutes);
    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  // Node's fetch (undici) adds `Cache-Control: no-cache` to requests with
  // manual conditional headers, which makes Express's req.fresh always false.
  // Browsers revalidate via their HTTP cache without that header, so use
  // node:http here to mirror what a browser actually sends.
  async function conditionalGet(
    url: string,
    etag: string | null,
  ): Promise<{ status: number; etag: string | null; body: string }> {
    const { request } = await import('node:http');
    return new Promise((resolve, reject) => {
      const req = request(
        url,
        { headers: etag ? { 'If-None-Match': etag } : {} },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              etag: res.headers.etag ?? null,
              body,
            }),
          );
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('serves a weak version ETag and no-cache on queue reads', async () => {
    const event = await seedEvent(testDb.db, { seeding_rounds: 1 });
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'seeding',
      queue_position: 1,
      seeding_team_id: team.id,
      seeding_round: 1,
    });

    const res = await http.get(`${baseUrl}/queue/event/${event.id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toMatch(/^W\/"queue-v\d+"$/);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('answers unchanged conditional polls with 304 and an empty body', async () => {
    const event = await seedEvent(testDb.db, { seeding_rounds: 1 });
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'seeding',
      queue_position: 1,
      seeding_team_id: team.id,
      seeding_round: 1,
    });

    const first = await http.get(`${baseUrl}/queue/event/${event.id}`);
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();

    const second = await conditionalGet(
      `${baseUrl}/queue/event/${event.id}`,
      etag,
    );
    expect(second.status).toBe(304);
    expect(second.body).toBe('');
  });

  it('bumps the version on queue mutations so stale ETags get fresh data', async () => {
    const event = await seedEvent(testDb.db, { seeding_rounds: 1 });
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const item = await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'seeding',
      queue_position: 1,
      seeding_team_id: team.id,
      seeding_round: 1,
    });

    const first = await http.get(`${baseUrl}/queue/event/${event.id}`);
    const etag = first.headers.get('ETag');

    const patch = await http.patch(`${baseUrl}/queue/${item.id}`, {
      status: 'called',
    });
    expect(patch.status).toBe(200);

    const second = await conditionalGet(
      `${baseUrl}/queue/event/${event.id}`,
      etag,
    );
    expect(second.status).toBe(200);
    expect(second.etag).toBeTruthy();
    expect(second.etag).not.toBe(etag);
    const items = JSON.parse(second.body) as { status: string }[];
    expect(items[0].status).toBe('called');
  });

  it('POST /queue changes the ETag for subsequent polls', async () => {
    const event = await seedEvent(testDb.db, { seeding_rounds: 1 });
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    // Seed a clean version row so the first read doesn't repair-sync.
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'seeding',
      queue_position: 1,
      seeding_team_id: team.id,
      seeding_round: 1,
    });

    const before = await http.get(`${baseUrl}/queue/event/${event.id}`);
    const etag = before.headers.get('ETag');

    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 2,
    });
    const created = await http.post(`${baseUrl}/queue`, {
      event_id: event.id,
      queue_type: 'seeding',
      seeding_team_id: team2.id,
      seeding_round: 1,
    });
    expect(created.status).toBe(201);

    const after = await conditionalGet(
      `${baseUrl}/queue/event/${event.id}`,
      etag,
    );
    expect(after.status).toBe(200);
    expect(after.etag).not.toBe(etag);
    expect((JSON.parse(after.body) as unknown[]).length).toBe(2);
  });

  it('reorder invalidates every event with an updated row', async () => {
    const eventA = await seedEvent(testDb.db, { seeding_rounds: 1 });
    const eventB = await seedEvent(testDb.db, {
      name: 'Second Event',
      seeding_rounds: 1,
    });
    const teamA = await seedTeam(testDb.db, {
      event_id: eventA.id,
      team_number: 1,
    });
    const teamB = await seedTeam(testDb.db, {
      event_id: eventB.id,
      team_number: 2,
    });
    const itemA = await seedQueueItem(testDb.db, {
      event_id: eventA.id,
      queue_type: 'seeding',
      queue_position: 1,
      seeding_team_id: teamA.id,
      seeding_round: 1,
    });
    const itemB = await seedQueueItem(testDb.db, {
      event_id: eventB.id,
      queue_type: 'seeding',
      queue_position: 1,
      seeding_team_id: teamB.id,
      seeding_round: 1,
    });

    const beforeA = await http.get(`${baseUrl}/queue/event/${eventA.id}`);
    const beforeB = await http.get(`${baseUrl}/queue/event/${eventB.id}`);

    const reordered = await http.post(`${baseUrl}/queue/reorder`, {
      items: [
        { id: 999_999, queue_position: 1 },
        { id: itemA.id, queue_position: 2 },
        { id: itemB.id, queue_position: 3 },
      ],
    });
    expect(reordered.status).toBe(200);

    const afterA = await conditionalGet(
      `${baseUrl}/queue/event/${eventA.id}`,
      beforeA.headers.get('ETag'),
    );
    const afterB = await conditionalGet(
      `${baseUrl}/queue/event/${eventB.id}`,
      beforeB.headers.get('ETag'),
    );
    expect(afterA.status).toBe(200);
    expect(afterB.status).toBe(200);
    expect(afterA.etag).not.toBe(beforeA.headers.get('ETag'));
    expect(afterB.etag).not.toBe(beforeB.headers.get('ETag'));
  });

  it('repair-syncs on read when the dirty flag is set', async () => {
    const event = await seedEvent(testDb.db, { seeding_rounds: 1 });
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    // Clean version row, empty queue: reads stay empty...
    await testDb.db.run(
      'INSERT INTO queue_versions (event_id, version, dirty) VALUES (?, 1, 0)',
      [event.id],
    );
    const before = await http.get(`${baseUrl}/queue/event/${event.id}`);
    expect(before.status).toBe(200);
    expect(before.json).toEqual([]);

    // ...until something marks the queue dirty (as source-table mutations do).
    await testDb.db.run(
      'UPDATE queue_versions SET dirty = 1 WHERE event_id = ?',
      [event.id],
    );

    const after = await http.get(`${baseUrl}/queue/event/${event.id}`);
    expect(after.status).toBe(200);
    const items = after.json as { seeding_team_id: number }[];
    expect(items.length).toBe(1);
    expect(items[0].seeding_team_id).toBe(team.id);

    // The repair also clears the dirty flag so later reads skip the sync.
    const state = await testDb.db.get<{ dirty: number }>(
      'SELECT dirty FROM queue_versions WHERE event_id = ?',
      [event.id],
    );
    expect(Number(state?.dirty)).toBe(0);
  });

  it('a dirty repair that changes rows also changes the ETag', async () => {
    const event = await seedEvent(testDb.db, { seeding_rounds: 1 });
    await seedTeam(testDb.db, { event_id: event.id, team_number: 1 });
    await testDb.db.run(
      'INSERT INTO queue_versions (event_id, version, dirty) VALUES (?, 1, 0)',
      [event.id],
    );

    const before = await http.get(`${baseUrl}/queue/event/${event.id}`);
    const etag = before.headers.get('ETag');
    expect(before.json).toEqual([]);

    await testDb.db.run(
      'UPDATE queue_versions SET dirty = 1 WHERE event_id = ?',
      [event.id],
    );

    const after = await conditionalGet(
      `${baseUrl}/queue/event/${event.id}`,
      etag,
    );
    expect(after.status).toBe(200);
    expect(after.etag).not.toBe(etag);
    expect((JSON.parse(after.body) as unknown[]).length).toBe(1);
  });
});
