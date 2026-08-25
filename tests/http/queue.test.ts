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
  seedScoresheetTemplate,
  seedScoreSubmission,
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
        status: 'scored',
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
        status: 'on_table',
      });

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?status=queued|on_table`,
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

    it('returns bracket_name for bracket queue items', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const bracket = await seedBracket(testDb.db, {
        event_id: event.id,
        name: 'Main Bracket',
      });
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team.id,
        team2_id: team.id,
        status: 'ready',
      });
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'bracket',
        queue_position: 1,
        bracket_game_id: game.id,
      });

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?queue_type=bracket`,
      );

      expect(res.status).toBe(200);
      const items = res.json as { bracket_name: string }[];
      expect(items.length).toBe(1);
      expect(items[0].bracket_name).toBe('Main Bracket');
    });

    it('with sync=1 and queue_type=seeding populates team×round items and removes queue row when seeding_scores exist', async () => {
      const event = await seedEvent(testDb.db, { seeding_rounds: 2 });
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 102,
      });
      await seedSeedingScore(testDb.db, {
        team_id: team1.id,
        round_number: 1,
        score: 85,
      });

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?queue_type=seeding&sync=1`,
      );

      expect(res.status).toBe(200);
      const items = res.json as {
        seeding_team_id: number;
        seeding_round: number;
        status: string;
      }[];
      expect(items.length).toBe(3);
      const done = items.find(
        (i) => i.seeding_team_id === team1.id && i.seeding_round === 1,
      );
      expect(done).toBeUndefined();
      const queued = items.filter((i) => i.status === 'queued');
      expect(queued.length).toBe(3);
    });

    it('with sync=1 and queue_type=seeding removes item when score submission is accepted', async () => {
      const event = await seedEvent(testDb.db, { seeding_rounds: 1 });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const template = await seedScoresheetTemplate(testDb.db);
      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
          grand_total: { value: 77 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'accepted',
      });

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?queue_type=seeding&sync=1`,
      );

      expect(res.status).toBe(200);
      const items = res.json as {
        seeding_team_id: number;
        seeding_round: number;
        status: string;
      }[];
      expect(items.length).toBe(0);
    });

    it('with sync=1 and queue_type=seeding keeps item queued when score submission is pending (reverted)', async () => {
      const event = await seedEvent(testDb.db, { seeding_rounds: 1 });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const template = await seedScoresheetTemplate(testDb.db);
      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          team_id: { value: team.id },
          round: { value: 1 },
          grand_total: { value: 77 },
        }),
        event_id: event.id,
        score_type: 'seeding',
        status: 'pending',
      });

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?queue_type=seeding&sync=1`,
      );

      expect(res.status).toBe(200);
      const items = res.json as {
        seeding_team_id: number;
        seeding_round: number;
        status: string;
      }[];
      expect(items.length).toBe(1);
      expect(items[0].seeding_team_id).toBe(team.id);
      expect(items[0].seeding_round).toBe(1);
      expect(items[0].status).toBe('queued');
    });

    it('with sync=1 and queue_type=bracket populates eligible bracket games', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team.id,
        team2_id: team.id,
        status: 'ready',
      });
      await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 2,
        team1_id: team.id,
        team2_id: team.id,
        status: 'pending',
      });

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?queue_type=bracket&sync=1`,
      );

      expect(res.status).toBe(200);
      const items = res.json as { queue_type: string; status: string }[];
      expect(items.length).toBe(2);
      expect(items.every((i) => i.queue_type === 'bracket')).toBe(true);
      expect(items.every((i) => i.status === 'queued')).toBe(true);
    });

    it('with sync=1 and queue_type=bracket removes item when score submission is accepted', async () => {
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
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
        status: 'ready',
      });
      const template = await seedScoresheetTemplate(testDb.db);
      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          winner_team_id: { value: team1.id },
        }),
        event_id: event.id,
        score_type: 'bracket',
        bracket_game_id: game.id,
        status: 'accepted',
      });

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?queue_type=bracket&sync=1`,
      );

      expect(res.status).toBe(200);
      const items = res.json as {
        bracket_game_id: number;
        status: string;
      }[];
      expect(items.length).toBe(0);
    });

    it('with sync=1 and queue_type=bracket keeps item queued when score submission is pending (reverted)', async () => {
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
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
        status: 'ready',
      });
      const template = await seedScoresheetTemplate(testDb.db);
      await seedScoreSubmission(testDb.db, {
        template_id: template.id,
        score_data: JSON.stringify({
          winner_team_id: { value: team1.id },
        }),
        event_id: event.id,
        score_type: 'bracket',
        bracket_game_id: game.id,
        status: 'pending',
      });

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?queue_type=bracket&sync=1`,
      );

      expect(res.status).toBe(200);
      const items = res.json as {
        bracket_game_id: number;
        status: string;
      }[];
      expect(items.length).toBe(1);
      expect(items[0].bracket_game_id).toBe(game.id);
      expect(items[0].status).toBe('queued');
    });

    it('first read repair-syncs an event with no version row, then stays stable', async () => {
      const event = await seedEvent(testDb.db, { seeding_rounds: 2 });
      await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 101,
      });

      // No queue_versions row yet, so the queue is considered dirty and the
      // first read runs a repair sync (one item per team per seeding round).
      const first = await http.get(`${baseUrl}/queue/event/${event.id}`);
      expect(first.status).toBe(200);
      const items = first.json as { seeding_round: number; status: string }[];
      expect(items.length).toBe(2);
      expect(items.map((item) => item.seeding_round).sort()).toEqual([1, 2]);

      // Once clean, subsequent reads return the same state without re-syncing.
      const second = await http.get(`${baseUrl}/queue/event/${event.id}`);
      expect(second.status).toBe(200);
      expect((second.json as unknown[]).length).toBe(2);
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

    it('returns 400 when event_id is missing', async () => {
      const res = await http.post(`${baseUrl}/queue/populate-from-bracket`, {
        bracket_id: 1,
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('event_id');
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

    it('returns 404 when event not found', async () => {
      const res = await http.post(`${baseUrl}/queue/populate-from-bracket`, {
        event_id: 999,
      });

      expect(res.status).toBe(404);
      expect((res.json as { error: string }).error).toContain(
        'Event not found',
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

    it('preserves non-bracket queue rows', async () => {
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

      // Verify the unrelated seeding item remains.
      const getRes = await http.get(`${baseUrl}/queue/event/${event.id}`);
      expect((getRes.json as unknown[]).length).toBe(1);
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

      const getRes = await http.get(`${baseUrl}/queue/event/${event.id}`);
      const items = getRes.json as {
        seeding_team_id: number;
        seeding_round: number;
      }[];
      expect(items.length).toBe(5);
      // team1 round1 is scored, so first two items should be round 1 for remaining teams.
      expect(items[0].seeding_team_id).toBe(team2.id);
      expect(items[0].seeding_round).toBe(1);
      expect(items[1].seeding_team_id).toBe(team1.id);
      expect(items[1].seeding_round).toBe(2);
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
  // PATCH /queue/:id/presence
  // ==========================================================================

  describe('PATCH /queue/:id/presence', () => {
    async function seedPairedBracketItem(status = 'queued') {
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
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
        status: 'ready',
      });
      const item = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'bracket',
        queue_position: 1,
        bracket_game_id: game.id,
        status,
      });
      return { event, team1, team2, game, item };
    }

    it('requires authentication and a valid request body', async () => {
      const unauthApp = createTestApp();
      unauthApp.use('/queue', queueRoutes);
      const unauthServer = await startServer(unauthApp);

      try {
        const unauthorized = await http.patch(
          `${unauthServer.baseUrl}/queue/1/presence`,
          { team_id: 1, present: true },
        );
        expect(unauthorized.status).toBe(401);
      } finally {
        await unauthServer.close();
      }

      const invalid = await http.patch(`${baseUrl}/queue/1/presence`, {
        team_id: 'team-1',
        present: 'yes',
      });
      expect(invalid.status).toBe(400);
    });

    it('confirms each bracket participant and advances atomically on the second', async () => {
      const { event, team1, team2, item } =
        await seedPairedBracketItem('called');

      const first = await http.patch(`${baseUrl}/queue/${item.id}/presence`, {
        team_id: team1.id,
        present: true,
      });
      expect(first.status).toBe(200);
      expect(first.json).toMatchObject({
        id: item.id,
        status: 'called',
        team1_present: true,
        team2_present: false,
      });

      const listed = await http.get(`${baseUrl}/queue/event/${event.id}`);
      expect((listed.json as Record<string, unknown>[])[0]).toMatchObject({
        team1_present: true,
        team2_present: false,
      });

      const second = await http.patch(`${baseUrl}/queue/${item.id}/presence`, {
        team_id: team2.id,
        present: true,
      });
      expect(second.status).toBe(200);
      expect(second.json).toMatchObject({
        status: 'arrived',
        team1_present: true,
        team2_present: true,
      });
    });

    it('allows undo while called and rejects unrelated teams or the wrong state', async () => {
      const { event, team1, team2, item } =
        await seedPairedBracketItem('called');
      const unrelated = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 103,
      });

      await http.patch(`${baseUrl}/queue/${item.id}/presence`, {
        team_id: team1.id,
        present: true,
      });
      const undone = await http.patch(`${baseUrl}/queue/${item.id}/presence`, {
        team_id: team1.id,
        present: false,
      });
      expect(undone.status).toBe(200);
      expect(undone.json).toMatchObject({
        status: 'called',
        team1_present: false,
        team2_present: false,
      });

      const unrelatedResponse = await http.patch(
        `${baseUrl}/queue/${item.id}/presence`,
        { team_id: unrelated.id, present: true },
      );
      expect(unrelatedResponse.status).toBe(409);

      await testDb.db.run(
        "UPDATE game_queue SET status = 'arrived' WHERE id = ?",
        [item.id],
      );
      const wrongState = await http.patch(
        `${baseUrl}/queue/${item.id}/presence`,
        { team_id: team2.id, present: true },
      );
      expect(wrongState.status).toBe(409);
    });

    it('reconciles simultaneous confirmations to arrived', async () => {
      const { team1, team2, item } = await seedPairedBracketItem('called');

      const [first, second] = await Promise.all([
        http.patch(`${baseUrl}/queue/${item.id}/presence`, {
          team_id: team1.id,
          present: true,
        }),
        http.patch(`${baseUrl}/queue/${item.id}/presence`, {
          team_id: team2.id,
          present: true,
        }),
      ]);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const row = await testDb.db.get<{
        status: string;
        present_team1_id: number;
        present_team2_id: number;
      }>('SELECT * FROM game_queue WHERE id = ?', [item.id]);
      expect(row).toMatchObject({
        status: 'arrived',
        present_team1_id: team1.id,
        present_team2_id: team2.id,
      });
    });

    it('normalizes a stored confirmation against replacement participants', async () => {
      const { event, team1, team2, game, item } =
        await seedPairedBracketItem('called');
      const replacement = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 104,
      });
      await testDb.db.run(
        `UPDATE game_queue
         SET present_team1_id = ?, present_team2_id = ? WHERE id = ?`,
        [team1.id, team2.id, item.id],
      );
      await testDb.db.run(
        'UPDATE bracket_games SET team1_id = ? WHERE id = ?',
        [replacement.id, game.id],
      );

      const listed = await http.get(`${baseUrl}/queue/event/${event.id}`);
      expect((listed.json as Record<string, unknown>[])[0]).toMatchObject({
        team1_id: replacement.id,
        team1_present: false,
        team2_present: true,
      });
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
        status: 'on_table',
      });

      expect(res.status).toBe(200);
      expect((res.json as { status: string }).status).toBe('on_table');
    });

    it('advances a called queue item to arrived', async () => {
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

      const calledRes = await http.patch(
        `${baseUrl}/queue/${item.id}/call`,
        {},
      );
      expect(calledRes.status).toBe(200);

      const arrivedRes = await http.patch(`${baseUrl}/queue/${item.id}`, {
        status: 'arrived',
      });

      expect(arrivedRes.status).toBe(200);
      expect((arrivedRes.json as { status: string }).status).toBe('arrived');
    });

    it('blocks paired matches from bypassing the presence checkpoint', async () => {
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
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
      });
      const item = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'bracket',
        queue_position: 1,
        bracket_game_id: game.id,
        status: 'called',
      });

      for (const status of ['arrived', 'on_table', 'scored']) {
        const response = await http.patch(`${baseUrl}/queue/${item.id}`, {
          status,
        });
        expect(response.status).toBe(409);
      }
    });

    it('allows confirmed paired advances and legacy post-arrival rows', async () => {
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
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
      });
      const item = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'bracket',
        queue_position: 1,
        bracket_game_id: game.id,
        status: 'called',
        present_team1_id: team1.id,
        present_team2_id: team2.id,
      });

      const confirmed = await http.patch(`${baseUrl}/queue/${item.id}`, {
        status: 'on_table',
      });
      expect(confirmed.status).toBe(200);

      await testDb.db.run(
        `UPDATE game_queue
         SET status = 'arrived', present_team1_id = NULL,
             present_team2_id = NULL
         WHERE id = ?`,
        [item.id],
      );
      const legacy = await http.patch(`${baseUrl}/queue/${item.id}`, {
        status: 'on_table',
      });
      expect(legacy.status).toBe(200);
      expect((legacy.json as { status: string }).status).toBe('on_table');
    });

    it('clears confirmations on back/call resets and retains them after arrival', async () => {
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
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
      });
      const item = await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'bracket',
        queue_position: 1,
        bracket_game_id: game.id,
        status: 'on_table',
        present_team1_id: team1.id,
        present_team2_id: team2.id,
      });

      const arrived = await http.patch(`${baseUrl}/queue/${item.id}`, {
        status: 'arrived',
      });
      expect(arrived.status).toBe(200);
      let row = await testDb.db.get<Record<string, unknown>>(
        'SELECT * FROM game_queue WHERE id = ?',
        [item.id],
      );
      expect(row).toMatchObject({
        present_team1_id: team1.id,
        present_team2_id: team2.id,
      });

      const called = await http.patch(`${baseUrl}/queue/${item.id}`, {
        status: 'called',
      });
      expect(called.status).toBe(200);
      row = await testDb.db.get<Record<string, unknown>>(
        'SELECT * FROM game_queue WHERE id = ?',
        [item.id],
      );
      expect(row).toMatchObject({
        status: 'called',
        present_team1_id: null,
        present_team2_id: null,
      });

      await testDb.db.run(
        `UPDATE game_queue
         SET present_team1_id = ?, present_team2_id = ? WHERE id = ?`,
        [team1.id, team2.id, item.id],
      );
      const recalled = await http.patch(`${baseUrl}/queue/${item.id}/call`, {});
      expect(recalled.status).toBe(200);
      expect(recalled.json).toMatchObject({
        present_team1_id: null,
        present_team2_id: null,
      });
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
