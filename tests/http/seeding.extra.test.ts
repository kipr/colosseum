/**
 * Additional seeding route tests targeting uncovered PATCH/DELETE and recalculate paths.
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
  seedUser,
  seedTeam,
  seedSeedingScore,
} from './helpers/seed';
import seedingRoutes from '../../src/server/routes/seeding';

describe('Seeding Routes - additional coverage', () => {
  let testDb: TestDb;
  let server: TestServerHandle;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    const user = await seedUser(testDb.db);
    const app = createTestApp({ user: { id: user.id, is_admin: false } });
    app.use('/seeding', seedingRoutes);
    server = await startServer(app);
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  describe('PATCH /seeding/scores/:id', () => {
    it('updates seeding score', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const seedingScore = await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 1,
        score: 100,
      });

      const res = await http.patch(
        `${server.baseUrl}/seeding/scores/${seedingScore.id}`,
        { score: 200 },
      );
      expect(res.status).toBe(200);
      expect((res.json as { score: number }).score).toBe(200);
    });

    it('returns 400 when no valid fields', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const seedingScore = await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 1,
        score: 100,
      });

      const res = await http.patch(
        `${server.baseUrl}/seeding/scores/${seedingScore.id}`,
        { invalid_field: 'nope' },
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 when seeding score not found', async () => {
      const res = await http.patch(
        `${server.baseUrl}/seeding/scores/9999`,
        { score: 200 },
      );
      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /seeding/scores/:id', () => {
    it('deletes seeding score', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const seedingScore = await seedSeedingScore(testDb.db, {
        team_id: team.id,
        round_number: 1,
        score: 100,
      });

      const res = await http.delete(
        `${server.baseUrl}/seeding/scores/${seedingScore.id}`,
      );
      expect(res.status).toBe(204);
    });
  });

  describe('POST /seeding/rankings/recalculate/:eventId', () => {
    it('returns 404 when no teams found', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.post(
        `${server.baseUrl}/seeding/rankings/recalculate/${event.id}`,
      );
      expect(res.status).toBe(404);
    });

    it('recalculates rankings and returns updated data', async () => {
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
        score: 180,
      });
      await seedSeedingScore(testDb.db, {
        team_id: team2.id,
        round_number: 1,
        score: 100,
      });
      await seedSeedingScore(testDb.db, {
        team_id: team2.id,
        round_number: 2,
        score: 120,
      });

      const res = await http.post(
        `${server.baseUrl}/seeding/rankings/recalculate/${event.id}`,
      );
      expect(res.status).toBe(200);
      const data = res.json as {
        teamsRanked: number;
        rankings: unknown[];
      };
      expect(data.teamsRanked).toBe(2);
      expect(data.rankings).toHaveLength(2);
    });
  });

  describe('POST /seeding/scores - error handling', () => {
    it('returns 400 when team does not exist (FK constraint)', async () => {
      const res = await http.post(`${server.baseUrl}/seeding/scores`, {
        team_id: 99999,
        round_number: 1,
        score: 100,
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('Team does not exist');
    });

    it('returns 400 when missing required fields', async () => {
      const res = await http.post(`${server.baseUrl}/seeding/scores`, {
        score: 100,
      });
      expect(res.status).toBe(400);
    });
  });
});
