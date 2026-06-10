/**
 * HTTP tests for double-seeding queue listing, sync, and manual add.
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
import {
  seedEvent,
  seedTeam,
  seedScoresheetTemplate,
  seedScoreSubmission,
  seedDoubleSeedingMatch,
  seedQueueItem,
} from './helpers/seed';
import queueRoutes from '../../src/server/routes/queue';
import { resetAllRateLimiters } from '../../src/server/middleware/rateLimit';

interface QueueRow {
  id: number;
  queue_type: string;
  status: string;
  double_seeding_match_id: number | null;
  double_seeding_round: number | null;
  double_seeding_match_number: number | null;
  double_seeding_team1_number: number | null;
  double_seeding_team2_number: number | null;
}

describe('Queue - double seeding', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    resetAllRateLimiters();

    const app = createTestApp({ user: { id: 1, is_admin: true } });
    app.use('/queue', queueRoutes);

    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
    resetAllRateLimiters();
  });

  async function setup() {
    const event = await seedEvent(testDb.db, { double_seeding_rounds: 2 });
    const team1 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 1,
    });
    const team2 = await seedTeam(testDb.db, {
      event_id: event.id,
      team_number: 2,
    });
    return { event, team1, team2 };
  }

  it('sync inserts queued rows for ready matches and lists joined display fields', async () => {
    const { event, team1, team2 } = await setup();
    const match = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      match_number: 1,
      team1_id: team1.id,
      team2_id: team2.id,
    });

    const res = await http.get(
      `${baseUrl}/queue/event/${event.id}?queue_type=double_seeding&sync=1`,
    );
    expect(res.status).toBe(200);
    const rows = res.json as QueueRow[];
    expect(rows.length).toBe(1);
    expect(rows[0].queue_type).toBe('double_seeding');
    expect(rows[0].status).toBe('queued');
    expect(rows[0].double_seeding_match_id).toBe(match.id);
    expect(rows[0].double_seeding_round).toBe(1);
    expect(rows[0].double_seeding_match_number).toBe(1);
    expect(rows[0].double_seeding_team1_number).toBe(1);
    expect(rows[0].double_seeding_team2_number).toBe(2);
  });

  it('sync queues single-team (lone run) matches too', async () => {
    const { event, team1 } = await setup();
    await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      match_number: 1,
      team1_id: team1.id,
      team2_id: null,
    });

    const res = await http.get(
      `${baseUrl}/queue/event/${event.id}?queue_type=double_seeding&sync=1`,
    );
    const rows = res.json as QueueRow[];
    expect(rows.length).toBe(1);
    expect(rows[0].double_seeding_team2_number).toBeNull();
  });

  it('sync removes completed matches and marks pending submissions as scored', async () => {
    const { event, team1, team2 } = await setup();
    const completedMatch = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      match_number: 1,
      team1_id: team1.id,
      team2_id: team2.id,
      status: 'completed',
    });
    await seedQueueItem(testDb.db, {
      event_id: event.id,
      queue_type: 'double_seeding',
      double_seeding_match_id: completedMatch.id,
      queue_position: 1,
    });

    const pendingMatch = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 2,
      match_number: 1,
      team1_id: team1.id,
      team2_id: team2.id,
    });
    const template = await seedScoresheetTemplate(testDb.db);
    await seedScoreSubmission(testDb.db, {
      template_id: template.id,
      score_data: '{}',
      event_id: event.id,
      score_type: 'double_seeding',
      double_seeding_match_id: pendingMatch.id,
      status: 'pending',
    });

    const res = await http.get(
      `${baseUrl}/queue/event/${event.id}?queue_type=double_seeding&sync=1`,
    );
    const rows = res.json as QueueRow[];
    expect(rows.length).toBe(1);
    expect(rows[0].double_seeding_match_id).toBe(pendingMatch.id);
    expect(rows[0].status).toBe('scored');

    const completedQueueRows = await testDb.db.all(
      'SELECT * FROM game_queue WHERE double_seeding_match_id = ?',
      [completedMatch.id],
    );
    expect(completedQueueRows.length).toBe(0);
  });

  it('POST /queue validates and adds double-seeding items, preventing duplicates', async () => {
    const { event, team1, team2 } = await setup();
    const match = await seedDoubleSeedingMatch(testDb.db, {
      event_id: event.id,
      round_number: 1,
      match_number: 1,
      team1_id: team1.id,
      team2_id: team2.id,
    });

    const missing = await http.post(`${baseUrl}/queue`, {
      event_id: event.id,
      queue_type: 'double_seeding',
    });
    expect(missing.status).toBe(400);
    expect((missing.json as { error: string }).error).toContain(
      'double_seeding_match_id is required',
    );

    const created = await http.post(`${baseUrl}/queue`, {
      event_id: event.id,
      queue_type: 'double_seeding',
      double_seeding_match_id: match.id,
    });
    expect(created.status).toBe(201);
    expect(
      (created.json as { double_seeding_match_id: number })
        .double_seeding_match_id,
    ).toBe(match.id);

    const duplicate = await http.post(`${baseUrl}/queue`, {
      event_id: event.id,
      queue_type: 'double_seeding',
      double_seeding_match_id: match.id,
    });
    expect(duplicate.status).toBe(409);
  });
});
