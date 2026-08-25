import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setTestDatabaseAdapter } from '../../src/server/database/connection';
import queueRoutes from '../../src/server/routes/queue';
import { createTestDb, type TestDb } from '../sql/helpers/testDb';
import {
  createTestApp,
  http,
  startServer,
  type TestServerHandle,
} from './helpers/testServer';
import {
  seedBracket,
  seedBracketGame,
  seedDoubleSeedingMatch,
  seedEvent,
  seedQueueItem,
  seedTeam,
} from './helpers/seed';

describe('queue team-rest response', () => {
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

  async function conditionalGet(url: string, etag: string) {
    const { request } = await import('node:http');
    return new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request(
        url,
        { headers: { 'If-None-Match': etag } },
        (res) => {
          let body = '';
          res.on('data', (chunk) => (body += chunk));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('maps latest timestamps onto bracket, seeding, and double-seeding slots', async () => {
    const event = await seedEvent(testDb.db);
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 102,
    });
    const team3 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 103,
    });

    await testDb.db.run(
      `INSERT INTO seeding_scores (team_id, round_number, score, scored_at)
       VALUES (?, 9, 10, ?)`,
      [team1.id, '2026-08-25 10:00:00'],
    );

    const bracket = await seedBracket(testDb.db, { event_id: event.id });
    const completedGame = await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 1,
      team1_id: team2.id,
      team2_id: team3.id,
      status: 'completed',
    });
    await testDb.db.run(
      'UPDATE bracket_games SET completed_at = ? WHERE id = ?',
      ['2026-08-25 11:00:00', completedGame.id],
    );

    const completedDoubleMatch = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 9,
      team1_id: team3.id,
      status: 'completed',
    });
    await testDb.db.run(
      'UPDATE double_seeding_matches SET completed_at = ? WHERE id = ?',
      ['2026-08-25 12:00:00', completedDoubleMatch.id],
    );

    const queuedBracketGame = await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 2,
      team1_id: team1.id,
      team2_id: team2.id,
      status: 'ready',
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'bracket',
      bracket_game_id: queuedBracketGame.id,
      queue_position: 1,
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'seeding',
      seeding_team_id: team3.id,
      seeding_round: 1,
      queue_position: 2,
    });
    const queuedDoubleMatch = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      team1_id: team1.id,
      team2_id: team3.id,
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'double_seeding',
      double_seeding_match_id: queuedDoubleMatch.id,
      queue_position: 3,
    });

    const res = await http.get(`${baseUrl}/queue/event/${event.id}`);
    expect(res.status).toBe(200);
    const rows = res.json as Array<Record<string, unknown>>;
    const bracketRow = rows.find((row) => row.queue_type === 'bracket')!;
    const seedingRow = rows.find((row) => row.queue_type === 'seeding')!;
    const doubleRow = rows.find((row) => row.queue_type === 'double_seeding')!;

    expect(bracketRow.team1_last_played_at).toBe('2026-08-25T10:00:00.000Z');
    expect(bracketRow.team2_last_played_at).toBe('2026-08-25T11:00:00.000Z');
    expect(seedingRow.seeding_team_last_played_at).toBe(
      '2026-08-25T12:00:00.000Z',
    );
    expect(doubleRow.double_seeding_team1_last_played_at).toBe(
      '2026-08-25T10:00:00.000Z',
    );
    expect(doubleRow.double_seeding_team2_last_played_at).toBe(
      '2026-08-25T12:00:00.000Z',
    );
    expect(bracketRow.team1_busy).toBe(false);
    expect(seedingRow.seeding_team_busy).toBe(false);
  });

  it('reports active participation even when the active row is filtered out', async () => {
    const event = await seedEvent(testDb.db);
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 102,
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'seeding',
      seeding_team_id: team1.id,
      seeding_round: 1,
      queue_position: 1,
      status: 'on_table',
    });
    const bracket = await seedBracket(testDb.db, { event_id: event.id });
    const game = await seedBracketGame(testDb.db, {
      bracket_id: bracket.id,
      game_number: 1,
      team1_id: team1.id,
      team2_id: team2.id,
      status: 'ready',
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'bracket',
      bracket_game_id: game.id,
      queue_position: 2,
    });

    const res = await http.get(
      `${baseUrl}/queue/event/${event.id}?queue_type=bracket`,
    );
    const row = (res.json as Array<Record<string, unknown>>)[0];
    expect(row.team1_busy).toBe(true);
    expect(row.team2_busy).toBe(false);
  });

  it('keeps conditional responses stable while only wall-clock time passes', async () => {
    const event = await seedEvent(testDb.db);
    const team = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 101,
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'seeding',
      seeding_team_id: team.id,
      seeding_round: 1,
      queue_position: 1,
    });

    const first = await http.get(`${baseUrl}/queue/event/${event.id}`);
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();

    const second = await conditionalGet(
      `${baseUrl}/queue/event/${event.id}`,
      etag!,
    );
    expect(second.status).toBe(304);
    expect(second.body).toBe('');
  });
});
