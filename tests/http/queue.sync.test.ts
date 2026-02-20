/**
 * Additional queue sync tests for edge cases in syncSeedingQueue and syncBracketQueue.
 * Covers re-queuing completed items, invalid event IDs, bracket completed status syncing.
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

describe('Queue Routes – sync edge cases', () => {
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

  describe('seeding sync – re-queue completed items when score removed', () => {
    it('resets completed queue item to queued when seeding score no longer exists', async () => {
      const event = await seedEvent(testDb.db, { seeding_rounds: 1 });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      // Seed a score and a completed queue item
      const score = await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 1,
        score: 100,
      });
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'seeding',
        queue_position: 1,
        seeding_team_id: team.id,
        seeding_round: 1,
        status: 'completed',
      });

      // Remove the score
      await testDb.db.run('DELETE FROM seeding_scores WHERE id = ?', [
        score.id,
      ]);

      // Sync should reset item to queued
      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?queue_type=seeding&sync=1`,
      );
      expect(res.status).toBe(200);
      const items = res.json as { status: string }[];
      expect(items.length).toBe(1);
      expect(items[0].status).toBe('queued');
    });
  });

  describe('seeding sync – no event found', () => {
    it('returns empty when event does not exist', async () => {
      const res = await http.get(
        `${baseUrl}/queue/event/99999?queue_type=seeding&sync=1`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });
  });

  describe('bracket sync – completed game status', () => {
    it('marks bracket queue item completed when bracket game is completed', async () => {
      const event = await seedEvent(testDb.db);
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
      });
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
        status: 'completed',
      });

      // Pre-seed a queued bracket queue item for this game
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'bracket',
        queue_position: 1,
        bracket_game_id: game.id,
        status: 'queued',
      });

      // Sync should mark it completed
      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?queue_type=bracket&sync=1`,
      );
      expect(res.status).toBe(200);
      const items = res.json as { bracket_game_id: number; status: string }[];
      const item = items.find((i) => i.bracket_game_id === game.id);
      expect(item).toBeDefined();
      expect(item!.status).toBe('completed');
    });

    it('re-queues bracket item when game status reverts to ready', async () => {
      const event = await seedEvent(testDb.db);
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
      });
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      const game = await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: team2.id,
        status: 'ready',
      });

      // Pre-seed a completed bracket queue item
      await seedQueueItem(testDb.db, {
        event_id: event.id,
        queue_type: 'bracket',
        queue_position: 1,
        bracket_game_id: game.id,
        status: 'completed',
      });

      // Sync should reset it to queued since game is ready and eligible
      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?queue_type=bracket&sync=1`,
      );
      expect(res.status).toBe(200);
      const items = res.json as { bracket_game_id: number; status: string }[];
      const item = items.find((i) => i.bracket_game_id === game.id);
      expect(item).toBeDefined();
      expect(item!.status).toBe('queued');
    });

    it('does not add ineligible bracket games (missing teams)', async () => {
      const event = await seedEvent(testDb.db);
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team1.id,
        team2_id: null,
        status: 'pending',
      });

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?queue_type=bracket&sync=1`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });

    it('returns empty when no brackets exist', async () => {
      const event = await seedEvent(testDb.db);

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?queue_type=bracket&sync=1`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });
  });

  describe('sync=1 without queue_type syncs both', () => {
    it('syncs both seeding and bracket queues', async () => {
      const event = await seedEvent(testDb.db, { seeding_rounds: 1 });
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const bracket = await seedBracket(testDb.db, { event_id: event.id });
      await seedBracketGame(testDb.db, {
        bracket_id: bracket.id,
        game_number: 1,
        team1_id: team.id,
        team2_id: team.id,
        status: 'ready',
      });

      const res = await http.get(
        `${baseUrl}/queue/event/${event.id}?sync=true`,
      );
      expect(res.status).toBe(200);
      const items = res.json as { queue_type: string }[];
      const seedingItems = items.filter((i) => i.queue_type === 'seeding');
      const bracketItems = items.filter((i) => i.queue_type === 'bracket');
      expect(seedingItems.length).toBe(1);
      expect(bracketItems.length).toBe(1);
    });
  });

  describe('GET /queue/event/:eventId – invalid eventId', () => {
    it('returns 400 for non-numeric eventId', async () => {
      const res = await http.get(`${baseUrl}/queue/event/abc`);
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('Invalid');
    });
  });

  describe('POST /queue – FK constraint', () => {
    it('returns 400 for nonexistent event FK', async () => {
      const res = await http.post(`${baseUrl}/queue`, {
        event_id: 99999,
        queue_type: 'seeding',
        seeding_team_id: 99999,
        seeding_round: 1,
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('does not exist');
    });
  });
});
