/**
 * HTTP route tests for /seeding endpoints.
 * Covers seeding scores CRUD, rankings, and auth boundaries.
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
  seedUser,
  seedSeedingScore,
} from './helpers/seed';
import seedingRoutes from '../../src/server/routes/seeding';

describe('Seeding Routes', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(async () => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  // ==========================================================================
  // GET /seeding/scores/team/:teamId (public)
  // ==========================================================================

  describe('GET /seeding/scores/team/:teamId', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp();
      app.use('/seeding', seedingRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns empty array when no scores exist', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const res = await http.get(
        `${server.baseUrl}/seeding/scores/team/${team.id}`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });

    it('returns scores ordered by round_number', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 3,
        score: 300,
      });
      await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 1,
        score: 100,
      });
      await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 2,
        score: 200,
      });

      const res = await http.get(
        `${server.baseUrl}/seeding/scores/team/${team.id}`,
      );
      expect(res.status).toBe(200);
      const scores = res.json as { round_number: number; score: number }[];
      expect(scores.length).toBe(3);
      expect(scores[0].round_number).toBe(1);
      expect(scores[1].round_number).toBe(2);
      expect(scores[2].round_number).toBe(3);
    });
  });

  // ==========================================================================
  // GET /seeding/scores/event/:eventId (public)
  // ==========================================================================

  describe('GET /seeding/scores/event/:eventId', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp();
      app.use('/seeding', seedingRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns empty array when no scores exist', async () => {
      const event = await seedEvent(testDb.db);

      const res = await http.get(
        `${server.baseUrl}/seeding/scores/event/${event.id}`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });

    it('returns scores with team info for the event', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 42,
        team_name: 'Scorers',
      });

      await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 1,
        score: 150,
      });

      const res = await http.get(
        `${server.baseUrl}/seeding/scores/event/${event.id}`,
      );
      expect(res.status).toBe(200);
      const scores = res.json as {
        team_number: number;
        team_name: string;
        score: number;
      }[];
      expect(scores.length).toBe(1);
      expect(scores[0].team_number).toBe(42);
      expect(scores[0].team_name).toBe('Scorers');
      expect(scores[0].score).toBe(150);
    });
  });

  // ==========================================================================
  // POST /seeding/scores (public)
  // ==========================================================================

  describe('POST /seeding/scores', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp();
      app.use('/seeding', seedingRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 400 when team_id is missing', async () => {
      const res = await http.post(`${server.baseUrl}/seeding/scores`, {
        round_number: 1,
        score: 100,
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'team_id and round_number are required',
      );
    });

    it('returns 400 when round_number is missing', async () => {
      const res = await http.post(`${server.baseUrl}/seeding/scores`, {
        team_id: 1,
        score: 100,
      });
      expect(res.status).toBe(400);
    });

    it('creates a seeding score', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const res = await http.post(`${server.baseUrl}/seeding/scores`, {
        team_id: team.id,
        round_number: 1,
        score: 250,
      });

      expect(res.status).toBe(201);
      const score = res.json as {
        team_id: number;
        round_number: number;
        score: number;
      };
      expect(score.team_id).toBe(team.id);
      expect(score.round_number).toBe(1);
      expect(score.score).toBe(250);
    });

    it('upserts when same team_id and round_number', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      await http.post(`${server.baseUrl}/seeding/scores`, {
        team_id: team.id,
        round_number: 1,
        score: 100,
      });

      const res = await http.post(`${server.baseUrl}/seeding/scores`, {
        team_id: team.id,
        round_number: 1,
        score: 200,
      });

      expect(res.status).toBe(201);
      const score = res.json as { score: number };
      expect(score.score).toBe(200);
    });

    it('returns 400 when team does not exist', async () => {
      const res = await http.post(`${server.baseUrl}/seeding/scores`, {
        team_id: 9999,
        round_number: 1,
        score: 100,
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Team does not exist',
      );
    });
  });

  // ==========================================================================
  // PATCH /seeding/scores/:id (auth required)
  // ==========================================================================

  describe('PATCH /seeding/scores/:id', () => {
    it('returns 401 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/seeding', seedingRoutes);
      const server = await startServer(app);

      try {
        const res = await http.patch(`${server.baseUrl}/seeding/scores/1`, {
          score: 999,
        });
        expect(res.status).toBe(401);
      } finally {
        await server.close();
      }
    });

    it('returns 404 when score not found', async () => {
      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/seeding', seedingRoutes);
      const server = await startServer(app);

      try {
        const res = await http.patch(`${server.baseUrl}/seeding/scores/999`, {
          score: 100,
        });
        expect(res.status).toBe(404);
      } finally {
        await server.close();
      }
    });

    it('returns 400 when no valid fields provided', async () => {
      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/seeding', seedingRoutes);
      const server = await startServer(app);

      try {
        const res = await http.patch(`${server.baseUrl}/seeding/scores/1`, {
          invalid_field: 'value',
        });
        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain(
          'No valid fields',
        );
      } finally {
        await server.close();
      }
    });

    it('updates a seeding score', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const seedScore = await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 1,
        score: 100,
      });

      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/seeding', seedingRoutes);
      const server = await startServer(app);

      try {
        const res = await http.patch(
          `${server.baseUrl}/seeding/scores/${seedScore.id}`,
          { score: 500 },
        );
        expect(res.status).toBe(200);
        expect((res.json as { score: number }).score).toBe(500);
      } finally {
        await server.close();
      }
    });
  });

  // ==========================================================================
  // DELETE /seeding/scores/:id (auth required)
  // ==========================================================================

  describe('DELETE /seeding/scores/:id', () => {
    it('returns 401 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/seeding', seedingRoutes);
      const server = await startServer(app);

      try {
        const res = await http.delete(`${server.baseUrl}/seeding/scores/1`);
        expect(res.status).toBe(401);
      } finally {
        await server.close();
      }
    });

    it('returns 204 when deleting a score', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const seedScore = await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 1,
        score: 100,
      });

      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/seeding', seedingRoutes);
      const server = await startServer(app);

      try {
        const res = await http.delete(
          `${server.baseUrl}/seeding/scores/${seedScore.id}`,
        );
        expect(res.status).toBe(204);
      } finally {
        await server.close();
      }
    });

    it('returns 204 when score does not exist (idempotent)', async () => {
      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/seeding', seedingRoutes);
      const server = await startServer(app);

      try {
        const res = await http.delete(`${server.baseUrl}/seeding/scores/999`);
        expect(res.status).toBe(204);
      } finally {
        await server.close();
      }
    });
  });

  // ==========================================================================
  // GET /seeding/rankings/event/:eventId (public)
  // ==========================================================================

  describe('GET /seeding/rankings/event/:eventId', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp();
      app.use('/seeding', seedingRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns empty array when no rankings exist', async () => {
      const event = await seedEvent(testDb.db);

      const res = await http.get(
        `${server.baseUrl}/seeding/rankings/event/${event.id}`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });
  });

  // ==========================================================================
  // POST /seeding/rankings/recalculate/:eventId (auth required)
  // ==========================================================================

  describe('POST /seeding/rankings/recalculate/:eventId', () => {
    it('returns 401 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/seeding', seedingRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(
          `${server.baseUrl}/seeding/rankings/recalculate/1`,
        );
        expect(res.status).toBe(401);
      } finally {
        await server.close();
      }
    });

    it('returns 404 when no teams exist for event', async () => {
      const event = await seedEvent(testDb.db);
      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/seeding', seedingRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(
          `${server.baseUrl}/seeding/rankings/recalculate/${event.id}`,
        );
        expect(res.status).toBe(404);
        expect((res.json as { error: string }).error).toContain(
          'No teams found',
        );
      } finally {
        await server.close();
      }
    });

    it('recalculates rankings for teams with scores', async () => {
      const event = await seedEvent(testDb.db);
      const team1 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const team2 = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 2,
      });

      await seedSeedingScore(testDb.db, {
        team_id: team1.id,
        round_number: 1,
        score: 200,
      });
      await seedSeedingScore(testDb.db, {
        team_id: team1.id,
        round_number: 2,
        score: 300,
      });
      await seedSeedingScore(testDb.db, {
        team_id: team2.id,
        round_number: 1,
        score: 100,
      });

      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/seeding', seedingRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(
          `${server.baseUrl}/seeding/rankings/recalculate/${event.id}`,
        );
        expect(res.status).toBe(200);
        const result = res.json as {
          message: string;
          teamsRanked: number;
          rankings: { team_id: number }[];
        };
        expect(result.message).toBe('Rankings recalculated');
        expect(result.teamsRanked).toBeGreaterThan(0);
      } finally {
        await server.close();
      }
    });
  });
});
