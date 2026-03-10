/**
 * HTTP route tests for /documentation-scores endpoints.
 * All endpoints require admin. Covers category CRUD, team score upsert/delete, and read endpoints.
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
  seedDocumentationScoreCategory,
  seedDocumentationScore,
  seedDocumentationSubScore,
} from './helpers/seed';
import documentationScoresRoutes from '../../src/server/routes/documentationScores';

const adminUser = { id: 1, is_admin: true };
const nonAdminUser = { id: 2, is_admin: false };

describe('Documentation Scores Routes', () => {
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
  // Authentication Boundaries (requireAdmin)
  // ==========================================================================

  describe('Authentication Boundaries', () => {
    it('returns 403 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/documentation-scores', documentationScoresRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/documentation-scores/categories/event/1`,
        );
        expect(res.status).toBe(403);
        expect((res.json as { error: string }).error).toContain(
          'Admin access required',
        );
      } finally {
        await server.close();
      }
    });

    it('returns 403 when authenticated but not admin', async () => {
      const app = createTestApp({ user: nonAdminUser });
      app.use('/documentation-scores', documentationScoresRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/documentation-scores/categories/event/1`,
        );
        expect(res.status).toBe(403);
      } finally {
        await server.close();
      }
    });
  });

  // ==========================================================================
  // GET /documentation-scores/global-categories
  // ==========================================================================

  describe('GET /documentation-scores/global-categories', () => {
    it('returns global categories for admin', async () => {
      const app = createTestApp({ user: adminUser });
      app.use('/documentation-scores', documentationScoresRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/documentation-scores/global-categories`,
        );
        expect(res.status).toBe(200);
        expect(Array.isArray(res.json)).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('returns categories after creating one', async () => {
      const event = await seedEvent(testDb.db);
      await seedDocumentationScoreCategory(testDb.db, {
        event_id: event.id,
        ordinal: 1,
        name: 'Global Cat',
        max_score: 15,
      });

      const app = createTestApp({ user: adminUser });
      app.use('/documentation-scores', documentationScoresRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/documentation-scores/global-categories`,
        );
        expect(res.status).toBe(200);
        const cats = res.json as {
          id: number;
          name: string;
          max_score: number;
        }[];
        expect(cats.length).toBeGreaterThanOrEqual(1);
        const found = cats.find((c) => c.name === 'Global Cat');
        expect(found).toBeDefined();
        expect(found!.max_score).toBe(15);
      } finally {
        await server.close();
      }
    });
  });

  // ==========================================================================
  // GET /documentation-scores/categories/event/:eventId
  // ==========================================================================

  describe('GET /documentation-scores/categories/event/:eventId', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: adminUser });
      app.use('/documentation-scores', documentationScoresRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 404 when event not found', async () => {
      const res = await http.get(
        `${server.baseUrl}/documentation-scores/categories/event/9999`,
      );
      expect(res.status).toBe(404);
    });

    it('returns empty array when no categories exist', async () => {
      const event = await seedEvent(testDb.db);

      const res = await http.get(
        `${server.baseUrl}/documentation-scores/categories/event/${event.id}`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });

    it('returns categories ordered by ordinal', async () => {
      const event = await seedEvent(testDb.db);
      await seedDocumentationScoreCategory(testDb.db, {
        event_id: event.id,
        ordinal: 2,
        name: 'Second',
        max_score: 10,
      });
      await seedDocumentationScoreCategory(testDb.db, {
        event_id: event.id,
        ordinal: 1,
        name: 'First',
        max_score: 5,
      });

      const res = await http.get(
        `${server.baseUrl}/documentation-scores/categories/event/${event.id}`,
      );
      expect(res.status).toBe(200);
      const cats = res.json as { ordinal: number; name: string }[];
      expect(cats.length).toBe(2);
      expect(cats[0].ordinal).toBe(1);
      expect(cats[0].name).toBe('First');
      expect(cats[1].ordinal).toBe(2);
      expect(cats[1].name).toBe('Second');
    });
  });

  // ==========================================================================
  // POST /documentation-scores/categories
  // ==========================================================================

  describe('POST /documentation-scores/categories', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: adminUser });
      app.use('/documentation-scores', documentationScoresRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 400 when required fields missing', async () => {
      const res = await http.post(
        `${server.baseUrl}/documentation-scores/categories`,
        { event_id: 1 },
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when ordinal out of range', async () => {
      const event = await seedEvent(testDb.db);

      const res = await http.post(
        `${server.baseUrl}/documentation-scores/categories`,
        {
          event_id: event.id,
          ordinal: 5,
          name: 'Bad',
          max_score: 10,
        },
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('1 and 4');
    });

    it('returns 404 when event not found', async () => {
      const res = await http.post(
        `${server.baseUrl}/documentation-scores/categories`,
        {
          event_id: 9999,
          ordinal: 1,
          name: 'Cat',
          max_score: 10,
        },
      );
      expect(res.status).toBe(404);
    });

    it('creates a category', async () => {
      const event = await seedEvent(testDb.db);

      const res = await http.post(
        `${server.baseUrl}/documentation-scores/categories`,
        {
          event_id: event.id,
          ordinal: 1,
          name: 'Code Quality',
          weight: 1.5,
          max_score: 20,
        },
      );

      expect(res.status).toBe(201);
      const cat = res.json as {
        event_id: number;
        ordinal: number;
        name: string;
        weight: number;
        max_score: number;
      };
      expect(cat.event_id).toBe(event.id);
      expect(cat.ordinal).toBe(1);
      expect(cat.name).toBe('Code Quality');
      expect(cat.weight).toBe(1.5);
      expect(cat.max_score).toBe(20);
    });

    it('returns 409 when ordinal already exists for event', async () => {
      const event = await seedEvent(testDb.db);
      await seedDocumentationScoreCategory(testDb.db, {
        event_id: event.id,
        ordinal: 1,
        name: 'Existing',
        max_score: 10,
      });

      const res = await http.post(
        `${server.baseUrl}/documentation-scores/categories`,
        {
          event_id: event.id,
          ordinal: 1,
          name: 'Duplicate',
          max_score: 5,
        },
      );
      expect(res.status).toBe(409);
    });
  });

  // ==========================================================================
  // PATCH /documentation-scores/categories/:id
  // ==========================================================================

  describe('PATCH /documentation-scores/categories/:id', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: adminUser });
      app.use('/documentation-scores', documentationScoresRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 400 when event_id query param missing', async () => {
      const res = await http.patch(
        `${server.baseUrl}/documentation-scores/categories/1`,
        { ordinal: 2 },
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 when category not found for event', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.patch(
        `${server.baseUrl}/documentation-scores/categories/9999?event_id=${event.id}`,
        { ordinal: 2 },
      );
      expect(res.status).toBe(404);
    });

    it('updates ordinal for a category', async () => {
      const event = await seedEvent(testDb.db);
      const cat = await seedDocumentationScoreCategory(testDb.db, {
        event_id: event.id,
        ordinal: 1,
        name: 'Original',
        max_score: 10,
      });

      const res = await http.patch(
        `${server.baseUrl}/documentation-scores/categories/${cat.id}?event_id=${event.id}`,
        { ordinal: 2 },
      );

      expect(res.status).toBe(200);
      const updated = res.json as { ordinal: number; name: string };
      expect(updated.ordinal).toBe(2);
      expect(updated.name).toBe('Original');
    });
  });

  // ==========================================================================
  // DELETE /documentation-scores/categories/:id
  // ==========================================================================

  describe('DELETE /documentation-scores/categories/:id', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: adminUser });
      app.use('/documentation-scores', documentationScoresRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 400 when event_id query param missing', async () => {
      const res = await http.delete(
        `${server.baseUrl}/documentation-scores/categories/1`,
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 when category not found for event', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.delete(
        `${server.baseUrl}/documentation-scores/categories/9999?event_id=${event.id}`,
      );
      expect(res.status).toBe(404);
    });

    it('removes category link from event', async () => {
      const event = await seedEvent(testDb.db);
      const cat = await seedDocumentationScoreCategory(testDb.db, {
        event_id: event.id,
        ordinal: 1,
        name: 'ToRemove',
        max_score: 10,
      });

      const res = await http.delete(
        `${server.baseUrl}/documentation-scores/categories/${cat.id}?event_id=${event.id}`,
      );
      expect(res.status).toBe(204);
    });
  });

  // ==========================================================================
  // GET /documentation-scores/event/:eventId
  // ==========================================================================

  describe('GET /documentation-scores/event/:eventId', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: adminUser });
      app.use('/documentation-scores', documentationScoresRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 404 when event not found', async () => {
      const res = await http.get(
        `${server.baseUrl}/documentation-scores/event/9999`,
      );
      expect(res.status).toBe(404);
    });

    it('returns empty array when no scores exist', async () => {
      const event = await seedEvent(testDb.db);

      const res = await http.get(
        `${server.baseUrl}/documentation-scores/event/${event.id}`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });

    it('returns scores with team info and sub_scores', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 42,
        team_name: 'Doc Team',
      });
      const cat = await seedDocumentationScoreCategory(testDb.db, {
        event_id: event.id,
        ordinal: 1,
        name: 'Docs',
        max_score: 10,
      });
      const docScore = await seedDocumentationScore(testDb.db, {
        event_id: event.id,
        team_id: team.id,
        overall_score: 7,
      });
      await seedDocumentationSubScore(testDb.db, {
        documentation_score_id: docScore.id,
        category_id: cat.id,
        score: 7,
      });

      const res = await http.get(
        `${server.baseUrl}/documentation-scores/event/${event.id}`,
      );
      expect(res.status).toBe(200);
      const scores = res.json as {
        team_number: number;
        team_name: string;
        overall_score: number;
        sub_scores: { score: number }[];
      }[];
      expect(scores.length).toBe(1);
      expect(scores[0].team_number).toBe(42);
      expect(scores[0].team_name).toBe('Doc Team');
      expect(scores[0].overall_score).toBe(7);
      expect(scores[0].sub_scores.length).toBe(1);
      expect(scores[0].sub_scores[0].score).toBe(7);
    });
  });

  // ==========================================================================
  // GET /documentation-scores/team/:teamId
  // ==========================================================================

  describe('GET /documentation-scores/team/:teamId', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: adminUser });
      app.use('/documentation-scores', documentationScoresRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 404 when team not found', async () => {
      const res = await http.get(
        `${server.baseUrl}/documentation-scores/team/9999`,
      );
      expect(res.status).toBe(404);
    });

    it('returns null documentation_score when team has no score', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const res = await http.get(
        `${server.baseUrl}/documentation-scores/team/${team.id}`,
      );
      expect(res.status).toBe(200);
      const data = res.json as {
        documentation_score: null;
        sub_scores: unknown[];
      };
      expect(data.documentation_score).toBeNull();
      expect(data.sub_scores).toEqual([]);
    });

    it('returns team score with sub_scores', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const cat = await seedDocumentationScoreCategory(testDb.db, {
        event_id: event.id,
        ordinal: 1,
        max_score: 10,
      });
      const docScore = await seedDocumentationScore(testDb.db, {
        event_id: event.id,
        team_id: team.id,
        overall_score: 5,
      });
      await seedDocumentationSubScore(testDb.db, {
        documentation_score_id: docScore.id,
        category_id: cat.id,
        score: 5,
      });

      const res = await http.get(
        `${server.baseUrl}/documentation-scores/team/${team.id}`,
      );
      expect(res.status).toBe(200);
      const data = res.json as {
        documentation_score: { overall_score: number };
        sub_scores: { score: number }[];
      };
      expect(data.documentation_score.overall_score).toBe(5);
      expect(data.sub_scores.length).toBe(1);
      expect(data.sub_scores[0].score).toBe(5);
    });
  });

  // ==========================================================================
  // PUT /documentation-scores/event/:eventId/team/:teamId
  // ==========================================================================

  describe('PUT /documentation-scores/event/:eventId/team/:teamId', () => {
    let server: TestServerHandle;
    let app: ReturnType<typeof createTestApp>;

    beforeEach(async () => {
      // Seed admin user so scored_by FK is satisfied (adminUser.id = 1)
      await seedUser(testDb.db, { is_admin: true });
      app = createTestApp({ user: adminUser });
      app.use('/documentation-scores', documentationScoresRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 400 when sub_scores not array', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const res = await http.put(
        `${server.baseUrl}/documentation-scores/event/${event.id}/team/${team.id}`,
        { sub_scores: 'invalid' },
      );
      expect(res.status).toBe(400);
    });

    it('returns 404 when event or team not found', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const res = await http.put(
        `${server.baseUrl}/documentation-scores/event/9999/team/${team.id}`,
        { sub_scores: [] },
      );
      expect(res.status).toBe(404);

      const res2 = await http.put(
        `${server.baseUrl}/documentation-scores/event/${event.id}/team/9999`,
        { sub_scores: [] },
      );
      expect(res2.status).toBe(404);
    });

    it('returns 400 when team does not belong to event', async () => {
      const event1 = await seedEvent(testDb.db);
      const event2 = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event2.id,
        team_number: 1,
      });

      const res = await http.put(
        `${server.baseUrl}/documentation-scores/event/${event1.id}/team/${team.id}`,
        { sub_scores: [] },
      );
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'does not belong',
      );
    });

    it('returns 400 when category does not belong to event', async () => {
      const event1 = await seedEvent(testDb.db);
      const event2 = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event1.id,
        team_number: 1,
      });
      const cat = await seedDocumentationScoreCategory(testDb.db, {
        event_id: event2.id,
        ordinal: 1,
        max_score: 10,
      });

      const res = await http.put(
        `${server.baseUrl}/documentation-scores/event/${event1.id}/team/${team.id}`,
        {
          sub_scores: [{ category_id: cat.id, score: 5 }],
        },
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when score exceeds max_score', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const cat = await seedDocumentationScoreCategory(testDb.db, {
        event_id: event.id,
        ordinal: 1,
        max_score: 10,
      });

      const res = await http.put(
        `${server.baseUrl}/documentation-scores/event/${event.id}/team/${team.id}`,
        {
          sub_scores: [{ category_id: cat.id, score: 15 }],
        },
      );
      expect(res.status).toBe(400);
    });

    it('creates score and computes overall_score correctly', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const cat1 = await seedDocumentationScoreCategory(testDb.db, {
        event_id: event.id,
        ordinal: 1,
        name: 'A',
        weight: 1,
        max_score: 10,
      });
      const cat2 = await seedDocumentationScoreCategory(testDb.db, {
        event_id: event.id,
        ordinal: 2,
        name: 'B',
        weight: 2,
        max_score: 20,
      });

      const res = await http.put(
        `${server.baseUrl}/documentation-scores/event/${event.id}/team/${team.id}`,
        {
          sub_scores: [
            { category_id: cat1.id, score: 5 },
            { category_id: cat2.id, score: 10 },
          ],
        },
      );

      expect(res.status).toBe(200);
      const data = res.json as {
        overall_score: number;
        sub_scores: { score: number; category_name: string }[];
      };
      expect(data.overall_score).toBeCloseTo(1.5, 5);
      expect(data.sub_scores.length).toBe(2);
    });

    it('upserts when score already exists', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      const cat = await seedDocumentationScoreCategory(testDb.db, {
        event_id: event.id,
        ordinal: 1,
        name: 'Cat',
        max_score: 10,
      });
      const docScore = await seedDocumentationScore(testDb.db, {
        event_id: event.id,
        team_id: team.id,
        overall_score: 0.5,
      });
      await seedDocumentationSubScore(testDb.db, {
        documentation_score_id: docScore.id,
        category_id: cat.id,
        score: 5,
      });

      const res = await http.put(
        `${server.baseUrl}/documentation-scores/event/${event.id}/team/${team.id}`,
        { sub_scores: [{ category_id: cat.id, score: 8 }] },
      );

      expect(res.status).toBe(200);
      const data = res.json as { overall_score: number };
      // (8/10)*1 = 0.8
      expect(data.overall_score).toBeCloseTo(0.8, 5);
    });
  });

  // ==========================================================================
  // DELETE /documentation-scores/event/:eventId/team/:teamId
  // ==========================================================================

  describe('DELETE /documentation-scores/event/:eventId/team/:teamId', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: adminUser });
      app.use('/documentation-scores', documentationScoresRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 204 when deleting existing score', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });
      await seedDocumentationScore(testDb.db, {
        event_id: event.id,
        team_id: team.id,
        overall_score: 5,
      });

      const res = await http.delete(
        `${server.baseUrl}/documentation-scores/event/${event.id}/team/${team.id}`,
      );
      expect(res.status).toBe(204);
    });

    it('returns 204 when score does not exist (idempotent)', async () => {
      const event = await seedEvent(testDb.db);
      const team = await seedTeam(testDb.db, {
        event_id: event.id,
        team_number: 1,
      });

      const res = await http.delete(
        `${server.baseUrl}/documentation-scores/event/${event.id}/team/${team.id}`,
      );
      expect(res.status).toBe(204);
    });
  });
});
