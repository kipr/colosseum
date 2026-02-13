/**
 * HTTP route tests for /queue endpoints.
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
  seedBracket,
  seedBracketGame,
  seedQueueItem,
  seedSeedingScore,
} from './helpers/seed';
import queueRoutes from '../../src/server/routes/queue';

describe('Queue Routes', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  // Default authenticated user
  const authUser = { id: 1, is_admin: false };

  beforeEach(async () => {
    // Create fresh in-memory DB with schema
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    // Create test app with auth shim and mount queue routes
    const app = createTestApp({ user: authUser });
    app.use('/queue', queueRoutes);

    // Start server on ephemeral port
    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  // ==========================================================================
  // GET /queue/event/:eventId
  // ==========================================================================

  describe('GET /queue/event/:eventId', () => {
    it('returns empty array when no queue items exist', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.get(`${baseUrl}/queue/event/${event.id}`);

      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });

    it('returns queue items for the event', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
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
      expect(Array.isArray(res.json)).toBe(true);
      expect((res.json as unknown[]).length).toBe(1);
    });

    it('filters by single status value', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
        status: 'queued',
      });
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 2,
        seeding_team_id: team.id,
        seeding_round: 2,
        status: 'called',
      });

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?status=queued`,
      );

      expect(res.status).toBe(200);
      const items = res.json as { status: string }[];
      expect(items.length).toBe(1);
      expect(items[0].status).toBe('queued');
    });

    it('filters by comma-separated status values', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
        status: 'queued',
      });
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 2,
        seeding_team_id: team.id,
        seeding_round: 2,
        status: 'called',
      });
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 3,
        seeding_team_id: team.id,
        seeding_round: 3,
        status: 'completed',
      });

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?status=queued,called`,
      );

      expect(res.status).toBe(200);
      const items = res.json as { status: string }[];
      expect(items.length).toBe(2);
      expect(items.map((i) => i.status).sort()).toEqual(['called', 'queued']);
    });

    it('filters by pipe-separated status values', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
        status: 'queued',
      });
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 2,
        seeding_team_id: team.id,
        seeding_round: 2,
        status: 'in_progress',
      });

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?status=queued|in_progress`,
      );

      expect(res.status).toBe(200);
      const items = res.json as { status: string }[];
      expect(items.length).toBe(2);
    });

    it('filters by queue_type', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team.id,
        team2_id: team.id,
        status: 'ready',
      });
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
      });
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'bracket',
        queue_position: 2,
        bracket_game_id: game.id,
      });

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?queue_type=bracket`,
      );

      expect(res.status).toBe(200);
      const items = res.json as { queue_type: string }[];
      expect(items.length).toBe(1);
      expect(items[0].queue_type).toBe('bracket');
    });
  });

  // ==========================================================================
  // POST /queue
  // ==========================================================================

  describe('POST /queue', () => {
    it('returns 401 when not authenticated', async () => {
      // Create app without auth
      const unauthApp = createTestApp();
      unauthApp.use('/queue', queueRoutes);
      const unauthServer = await startServer(unauthApp);

      try {
        const res = await http.post(`${unauthServer.baseUrl}/queue`, {
          event_id: 1,
          queue_type: 'seeding',
        });
        expect(res.status).toBe(401);
      } finally {
        await unauthServer.close();
      }
    });

    it('returns 400 when event_id is missing', async () => {
      const res = await http.post(`${baseUrl}/queue`, {
        queue_type: 'seeding',
        seeding_team_id: 1,
        seeding_round: 1,
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('event_id');
    });

    it('returns 400 when queue_type is missing', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(`${baseUrl}/queue`, {
        event_id: event.id,
        seeding_team_id: 1,
        seeding_round: 1,
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('queue_type');
    });

    it('returns 400 when bracket_game_id missing for bracket type', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(`${baseUrl}/queue`, {
        event_id: event.id,
        queue_type: 'bracket',
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'bracket_game_id',
      );
    });

    it('returns 400 when seeding fields missing for seeding type', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(`${baseUrl}/queue`, {
        event_id: event.id,
        queue_type: 'seeding',
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'seeding_team_id',
      );
    });

    it('creates seeding queue item with auto position', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });

      const res = await http.post(`${baseUrl}/queue`, {
        event_id: event.id,
        queue_type: 'seeding',
        seeding_team_id: team.id,
        seeding_round: 1,
      });

      expect(res.status).toBe(201);
      const item = res.json as {
        id: number;
        queue_position: number;
        status: string;
      };
      expect(item.id).toBeGreaterThan(0);
      expect(item.queue_position).toBe(1);
      expect(item.status).toBe('queued');
    });

    it('auto increments queue_position', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });

      // Create first item
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 5,
        seeding_team_id: team.id,
        seeding_round: 1,
      });

      // Create second item via API
      const res = await http.post(`${baseUrl}/queue`, {
        event_id: event.id,
        queue_type: 'seeding',
        seeding_team_id: team.id,
        seeding_round: 2,
      });

      expect(res.status).toBe(201);
      expect((res.json as { queue_position: number }).queue_position).toBe(6);
    });

    it('returns 409 when bracket game already queued', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team.id,
        team2_id: team.id,
      });

      // Queue the game
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'bracket',
        queue_position: 1,
        bracket_game_id: game.id,
      });

      // Try to queue same game again
      const res = await http.post(`${baseUrl}/queue`, {
        event_id: event.id,
        queue_type: 'bracket',
        bracket_game_id: game.id,
      });

      expect(res.status).toBe(409);
      expect((res.json as { error: string }).error).toContain(
        'already in the queue',
      );
    });

    it('returns 409 when seeding round already queued', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });

      // Queue the seeding round
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
      });

      // Try to queue same seeding round again
      const res = await http.post(`${baseUrl}/queue`, {
        event_id: event.id,
        queue_type: 'seeding',
        seeding_team_id: team.id,
        seeding_round: 1,
      });

      expect(res.status).toBe(409);
      expect((res.json as { error: string }).error).toContain(
        'already in the queue',
      );
    });
  });

  // ==========================================================================
  // POST /queue/reorder
  // ==========================================================================

  describe('POST /queue/reorder', () => {
    it('returns 401 when not authenticated', async () => {
      const unauthApp = createTestApp();
      unauthApp.use('/queue', queueRoutes);
      const unauthServer = await startServer(unauthApp);

      try {
        const res = await http.post(`${unauthServer.baseUrl}/queue/reorder`, {
          items: [],
        });
        expect(res.status).toBe(401);
      } finally {
        await unauthServer.close();
      }
    });

    it('returns 400 when items is not an array', async () => {
      const res = await http.post(`${baseUrl}/queue/reorder`, {
        items: 'not an array',
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('items array');
    });

    it('returns 400 when items is empty', async () => {
      const res = await http.post(`${baseUrl}/queue/reorder`, {
        items: [],
      });

      expect(res.status).toBe(400);
    });

    it('reorders queue items successfully', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const item1 = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
      });
      const item2 = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 2,
        seeding_team_id: team.id,
        seeding_round: 2,
      });

      const res = await http.post(`${baseUrl}/queue/reorder`, {
        items: [
          { id: item1.id, queue_position: 2 },
          { id: item2.id, queue_position: 1 },
        ],
      });

      expect(res.status).toBe(200);
      expect((res.json as { updated: number }).updated).toBe(2);

      // Verify the order changed
      const getRes = await http.get(`${baseUrl}/queue/event/${event.id}`);
      const items = getRes.json as { id: number; queue_position: number }[];
      expect(items[0].id).toBe(item2.id);
      expect(items[1].id).toBe(item1.id);
    });

    it('PATCH /queue/reorder works as alias', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const item = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
      });

      const res = await http.patch(`${baseUrl}/queue/reorder`, {
        items: [{ id: item.id, queue_position: 10 }],
      });

      expect(res.status).toBe(200);
      expect((res.json as { updated: number }).updated).toBe(1);
    });
  });

  // ==========================================================================
  // POST /queue/populate-from-bracket
  // ==========================================================================

  describe('POST /queue/populate-from-bracket', () => {
    it('returns 401 when not authenticated', async () => {
      const unauthApp = createTestApp();
      unauthApp.use('/queue', queueRoutes);
      const unauthServer = await startServer(unauthApp);

      try {
        const res = await http.post(
          `${unauthServer.baseUrl}/queue/populate-from-bracket`,
          { event_id: 1, bracket_id: 1 },
        );
        expect(res.status).toBe(401);
      } finally {
        await unauthServer.close();
      }
    });

    it('returns 400 when event_id or bracket_id missing', async () => {
      const res = await http.post(`${baseUrl}/queue/populate-from-bracket`, {
        event_id: 1,
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('bracket_id');
    });

    it('returns 404 when bracket not found', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(`${baseUrl}/queue/populate-from-bracket`, {
        event_id: event.id,
        bracket_id: 999,
      });

      expect(res.status).toBe(404);
      expect((res.json as { error: string }).error).toContain(
        'Bracket not found',
      );
    });

    it('returns 400 when bracket belongs to different event', async () => {
      const event1 = await seedEvent(testDb.db, { name: 'Event 1' });
      const event2 = await seedEvent(testDb.db, { name: 'Event 2' });
      const bracket = await seedBracket(testDb.db, { event_id: event2.id });

      const res = await http.post(`${baseUrl}/queue/populate-from-bracket`, {
        event_id: event1.id,
        bracket_id: bracket.id,
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'does not belong to this event',
      );
    });

    it('populates queue with eligible bracket games', async () => {
      const event = await seedEvent(testDb.db);
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 102,
      });
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      // Eligible game (status 'ready' or 'pending', both teams assigned)
      await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
        status: 'ready',
      });

      // Ineligible game (missing team2)
      await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 2,
        team1_id: team1.id,
        team2_id: null,
        status: 'pending',
      });

      // Ineligible game (status 'completed')
      await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 3,
        team1_id: team1.id,
        team2_id: team2.id,
        status: 'completed',
      });

      const res = await http.post(`${baseUrl}/queue/populate-from-bracket`, {
        event_id: event.id,
        bracket_id: bracket.id,
      });

      expect(res.status).toBe(200);
      const result = res.json as { created: number; bracketGamesTotal: number };
      expect(result.created).toBe(1);
      expect(result.bracketGamesTotal).toBe(1);
    });

    it('replaces existing queue for the event', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const bracket = await seedBracket(testDb.db, { event_id: event.id });

      // Add existing queue item
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
      });

      // Populate from bracket (no eligible games)
      const res = await http.post(`${baseUrl}/queue/populate-from-bracket`, {
        event_id: event.id,
        bracket_id: bracket.id,
      });

      expect(res.status).toBe(200);
      expect((res.json as { created: number }).created).toBe(0);

      // Verify old queue item was deleted
      const getRes = await http.get(`${baseUrl}/queue/event/${event.id}`);
      expect((getRes.json as unknown[]).length).toBe(0);
    });
  });

  // ==========================================================================
  // POST /queue/populate-from-seeding
  // ==========================================================================

  describe('POST /queue/populate-from-seeding', () => {
    it('returns 401 when not authenticated', async () => {
      const unauthApp = createTestApp();
      unauthApp.use('/queue', queueRoutes);
      const unauthServer = await startServer(unauthApp);

      try {
        const res = await http.post(
          `${unauthServer.baseUrl}/queue/populate-from-seeding`,
          { event_id: 1 },
        );
        expect(res.status).toBe(401);
      } finally {
        await unauthServer.close();
      }
    });

    it('returns 400 when event_id missing', async () => {
      const res = await http.post(`${baseUrl}/queue/populate-from-seeding`, {});

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('event_id');
    });

    it('returns 404 when event not found', async () => {
      const res = await http.post(`${baseUrl}/queue/populate-from-seeding`, {
        event_id: 999,
      });

      expect(res.status).toBe(404);
      expect((res.json as { error: string }).error).toContain(
        'Event not found',
      );
    });

    it('returns 400 when no teams found for event', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(`${baseUrl}/queue/populate-from-seeding`, {
        event_id: event.id,
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('No teams found');
    });

    it('populates queue with unplayed seeding rounds', async () => {
      const event = await seedEvent(testDb.db, { seeding_rounds: 3 });
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 102,
      });

      // Team1 has played round 1
      await seedSeedingScore(testDb.db, {
        team_id: team1.id,
        round_number: 1,
        score: 100,
      });

      const res = await http.post(`${baseUrl}/queue/populate-from-seeding`, {
        event_id: event.id,
      });

      expect(res.status).toBe(200);
      const result = res.json as {
        created: number;
        totalTeams: number;
        totalRounds: number;
      };
      // 2 teams * 3 rounds = 6, minus 1 scored = 5 unplayed
      expect(result.created).toBe(5);
      expect(result.totalTeams).toBe(2);
      expect(result.totalRounds).toBe(3);
    });

    it('respects event seeding_rounds setting', async () => {
      const event = await seedEvent(testDb.db, { seeding_rounds: 2 });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });

      const res = await http.post(`${baseUrl}/queue/populate-from-seeding`, {
        event_id: event.id,
      });

      expect(res.status).toBe(200);
      // 1 team * 2 rounds = 2 unplayed
      expect((res.json as { created: number }).created).toBe(2);

      // Verify the queue items
      const getRes = await http.get(`${baseUrl}/queue/event/${event.id}`);
      const items = getRes.json as {
        seeding_team_id: number;
        seeding_round: number;
      }[];
      expect(items.length).toBe(2);
      expect(items[0].seeding_team_id).toBe(team.id);
      expect(items[0].seeding_round).toBe(1);
      expect(items[1].seeding_round).toBe(2);
    });
  });

  // ==========================================================================
  // PATCH /queue/:id
  // ==========================================================================

  describe('PATCH /queue/:id', () => {
    it('returns 401 when not authenticated', async () => {
      const unauthApp = createTestApp();
      unauthApp.use('/queue', queueRoutes);
      const unauthServer = await startServer(unauthApp);

      try {
        const res = await http.patch(`${unauthServer.baseUrl}/queue/1`, {
          status: 'called',
        });
        expect(res.status).toBe(401);
      } finally {
        await unauthServer.close();
      }
    });

    it('returns 400 when no valid fields provided', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const item = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
      });

      const res = await http.patch(`${baseUrl}/queue/${item.id}`, {
        invalid_field: 'value',
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'No valid fields',
      );
    });

    it('returns 404 when item not found', async () => {
      const res = await http.patch(`${baseUrl}/queue/999`, {
        status: 'called',
      });

      expect(res.status).toBe(404);
    });

    it('updates status successfully', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const item = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
      });

      const res = await http.patch(`${baseUrl}/queue/${item.id}`, {
        status: 'in_progress',
      });

      expect(res.status).toBe(200);
      expect((res.json as { status: string }).status).toBe('in_progress');
    });

    it('updates table_number successfully', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const item = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
      });

      const res = await http.patch(`${baseUrl}/queue/${item.id}`, {
        table_number: 5,
      });

      expect(res.status).toBe(200);
      expect((res.json as { table_number: number }).table_number).toBe(5);
    });

    it('returns 400 for invalid status value', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const item = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
      });

      const res = await http.patch(`${baseUrl}/queue/${item.id}`, {
        status: 'invalid_status',
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('Invalid status');
    });
  });

  // ==========================================================================
  // PATCH /queue/:id/call
  // ==========================================================================

  describe('PATCH /queue/:id/call', () => {
    it('returns 401 when not authenticated', async () => {
      const unauthApp = createTestApp();
      unauthApp.use('/queue', queueRoutes);
      const unauthServer = await startServer(unauthApp);

      try {
        const res = await http.patch(
          `${unauthServer.baseUrl}/queue/1/call`,
          {},
        );
        expect(res.status).toBe(401);
      } finally {
        await unauthServer.close();
      }
    });

    it('returns 404 when item not found', async () => {
      const res = await http.patch(`${baseUrl}/queue/999/call`, {});

      expect(res.status).toBe(404);
    });

    it('sets status to called and called_at', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const item = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
      });

      const res = await http.patch(`${baseUrl}/queue/${item.id}/call`, {});

      expect(res.status).toBe(200);
      const result = res.json as { status: string; called_at: string | null };
      expect(result.status).toBe('called');
      expect(result.called_at).not.toBeNull();
    });

    it('optionally updates table_number', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const item = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
      });

      const res = await http.patch(`${baseUrl}/queue/${item.id}/call`, {
        table_number: 3,
      });

      expect(res.status).toBe(200);
      const result = res.json as { status: string; table_number: number };
      expect(result.status).toBe('called');
      expect(result.table_number).toBe(3);
    });
  });

  // ==========================================================================
  // DELETE /queue/:id
  // ==========================================================================

  describe('DELETE /queue/:id', () => {
    it('returns 401 when not authenticated', async () => {
      const unauthApp = createTestApp();
      unauthApp.use('/queue', queueRoutes);
      const unauthServer = await startServer(unauthApp);

      try {
        const res = await http.delete(`${unauthServer.baseUrl}/queue/1`);
        expect(res.status).toBe(401);
      } finally {
        await unauthServer.close();
      }
    });

    it('returns 204 and removes the item', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const item = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
      });

      const res = await http.delete(`${baseUrl}/queue/${item.id}`);

      expect(res.status).toBe(204);

      // Verify item was deleted
      const getRes = await http.get(`${baseUrl}/queue/event/${event.id}`);
      expect((getRes.json as unknown[]).length).toBe(0);
    });

    it('returns 204 even when item does not exist (idempotent)', async () => {
      const res = await http.delete(`${baseUrl}/queue/999`);

      expect(res.status).toBe(204);
    });
  });
});
