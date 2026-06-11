/**
 * HTTP tests for rate-limiting middleware.
 * Verifies 429 responses, standard headers, and counter reset across
 * several limiter policies using the existing test server harness.
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
  seedEventScoresheetTemplate,
} from './helpers/seed';
import apiRoutes from '../../src/server/routes/api';
import scoresheetRoutes from '../../src/server/routes/scoresheet';
import chatRoutes from '../../src/server/routes/chat';
import queueRoutes from '../../src/server/routes/queue';
import { resetAllRateLimiters } from '../../src/server/middleware/rateLimit';

interface ErrorBody {
  error: string;
  message: string;
  limiter: string;
}

describe('Rate Limiting', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  afterEach(async () => {
    if (server) await server.close();
    __setTestDatabaseAdapter(null);
    if (testDb) testDb.close();
    resetAllRateLimiters();
  });

  // ==========================================================================
  // POST /api/scores/submit  –  scoreSubmitLimiter (30 req / 1 min)
  // ==========================================================================
  describe('scoreSubmitLimiter – POST /api/scores/submit', () => {
    beforeEach(async () => {
      testDb = await createTestDb();
      __setTestDatabaseAdapter(testDb.db);
      resetAllRateLimiters();

      // Use admin auth to bypass judge session requirement (testing rate limits, not auth)
      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/api', apiRoutes);
      server = await startServer(app);
      baseUrl = server.baseUrl;
    });

    it('allows requests under the limit', async () => {
      const res = await http.post(`${baseUrl}/api/scores/submit`, {
        scoreData: { points: 1 },
      });
      expect(res.status).toBe(400);
      expect(res.headers.get('ratelimit-limit')).toBe('30');
    });

    it('returns 429 after exceeding the limit', async () => {
      for (let i = 0; i < 30; i++) {
        await http.post(`${baseUrl}/api/scores/submit`, {});
      }

      const blocked = await http.post<ErrorBody>(
        `${baseUrl}/api/scores/submit`,
        {},
      );
      expect(blocked.status).toBe(429);
      expect(blocked.json.error).toBe('rate_limit_exceeded');
      expect(blocked.json.limiter).toBe('scoreSubmit');
    });

    it('includes standard rate-limit headers', async () => {
      const res = await http.post(`${baseUrl}/api/scores/submit`, {
        scoreData: { points: 1 },
      });
      expect(res.headers.has('ratelimit-limit')).toBe(true);
      expect(res.headers.has('ratelimit-remaining')).toBe(true);
      expect(res.headers.has('ratelimit-reset')).toBe(true);
    });

    it('resets counters via resetAllRateLimiters', async () => {
      for (let i = 0; i < 30; i++) {
        await http.post(`${baseUrl}/api/scores/submit`, {});
      }
      const blocked = await http.post(`${baseUrl}/api/scores/submit`, {});
      expect(blocked.status).toBe(429);

      resetAllRateLimiters();

      const afterReset = await http.post(`${baseUrl}/api/scores/submit`, {
        scoreData: { points: 1 },
      });
      expect(afterReset.status).not.toBe(429);
    });
  });

  // ==========================================================================
  // POST /scoresheet/templates/:id/verify  –  accessCodeLimiter (10 req / 15 min)
  // ==========================================================================
  describe('accessCodeLimiter – POST /scoresheet/templates/:id/verify', () => {
    let templateId: number;

    beforeEach(async () => {
      testDb = await createTestDb();
      __setTestDatabaseAdapter(testDb.db);
      resetAllRateLimiters();

      const template = await seedScoresheetTemplate(testDb.db, {
        name: 'Verify Template',
        access_code: 'secret123',
        schema: '[]',
      });
      templateId = template.id;

      const app = createTestApp();
      app.use('/scoresheet', scoresheetRoutes);
      server = await startServer(app);
      baseUrl = server.baseUrl;
    });

    it('allows requests under the limit', async () => {
      const res = await http.post(
        `${baseUrl}/scoresheet/templates/${templateId}/verify`,
        { accessCode: 'wrong' },
      );
      expect(res.status).toBe(403);
    });

    it('returns 429 after exceeding the limit', async () => {
      for (let i = 0; i < 10; i++) {
        await http.post(
          `${baseUrl}/scoresheet/templates/${templateId}/verify`,
          { accessCode: 'wrong' },
        );
      }

      const blocked = await http.post<ErrorBody>(
        `${baseUrl}/scoresheet/templates/${templateId}/verify`,
        { accessCode: 'wrong' },
      );
      expect(blocked.status).toBe(429);
      expect(blocked.json.limiter).toBe('accessCode');
    });

    it('isolates limits per template id', async () => {
      const other = await seedScoresheetTemplate(testDb.db, {
        name: 'Other Template',
        access_code: 'other',
        schema: '[]',
      });

      for (let i = 0; i < 10; i++) {
        await http.post(
          `${baseUrl}/scoresheet/templates/${templateId}/verify`,
          { accessCode: 'wrong' },
        );
      }

      const blockedOriginal = await http.post(
        `${baseUrl}/scoresheet/templates/${templateId}/verify`,
        { accessCode: 'wrong' },
      );
      expect(blockedOriginal.status).toBe(429);

      const otherStillAllowed = await http.post(
        `${baseUrl}/scoresheet/templates/${other.id}/verify`,
        { accessCode: 'wrong' },
      );
      expect(otherStillAllowed.status).not.toBe(429);
    });
  });

  // ==========================================================================
  // POST /chat/events/:eventId/messages  –  chatWriteLimiter (15 req / 1 min)
  // ==========================================================================
  describe('chatWriteLimiter – POST /chat/events/:eventId/messages', () => {
    let eventId: number;

    beforeEach(async () => {
      testDb = await createTestDb();
      __setTestDatabaseAdapter(testDb.db);
      resetAllRateLimiters();

      const event = await seedEvent(testDb.db);
      eventId = event.id;
      const template = await seedScoresheetTemplate(testDb.db);
      await seedEventScoresheetTemplate(testDb.db, {
        event_id: eventId,
        template_id: template.id,
        template_type: 'seeding',
      });

      const app = createTestApp({
        judgeSession: {
          templateId: template.id,
          eventIds: [eventId],
          conversationKey: 'rate-limit-conv',
          issuedAt: Date.now(),
          expiresAt: Date.now() + 60 * 60 * 1000,
        },
      });
      app.use('/chat', chatRoutes);
      server = await startServer(app);
      baseUrl = server.baseUrl;
    });

    it('returns 429 after exceeding the chat write limit', async () => {
      for (let i = 0; i < 15; i++) {
        await http.post(`${baseUrl}/chat/events/${eventId}/messages`, {
          message: `msg ${i}`,
        });
      }

      const blocked = await http.post<ErrorBody>(
        `${baseUrl}/chat/events/${eventId}/messages`,
        { message: 'one too many' },
      );
      expect(blocked.status).toBe(429);
      expect(blocked.json.limiter).toBe('chatWrite');
    });
  });

  // ==========================================================================
  // GET /chat/events/:eventId/messages  –  chatReadLimiter (120 req / 1 min)
  // ==========================================================================
  describe('chatReadLimiter – GET /chat/events/:eventId/messages', () => {
    let eventId: number;

    beforeEach(async () => {
      testDb = await createTestDb();
      __setTestDatabaseAdapter(testDb.db);
      resetAllRateLimiters();

      const event = await seedEvent(testDb.db);
      eventId = event.id;

      const app = createTestApp({
        judgeSession: {
          templateId: 1,
          eventIds: [eventId],
          conversationKey: 'read-limit-conv',
          issuedAt: Date.now(),
          expiresAt: Date.now() + 60 * 60 * 1000,
        },
      });
      app.use('/chat', chatRoutes);
      server = await startServer(app);
      baseUrl = server.baseUrl;
    });

    it('includes rate-limit headers on read requests', async () => {
      const res = await http.get(`${baseUrl}/chat/events/${eventId}/messages`);
      expect(res.headers.has('ratelimit-limit')).toBe(true);
      expect(res.headers.get('ratelimit-limit')).toBe('120');
    });
  });

  // ==========================================================================
  // GET /queue/event/:eventId?sync=1 – queueSyncLimiter (120 req / 1 min)
  // ==========================================================================
  describe('queueSyncLimiter – GET /queue/event/:eventId?sync=1', () => {
    let eventId: number;
    let otherEventId: number;

    beforeEach(async () => {
      testDb = await createTestDb();
      __setTestDatabaseAdapter(testDb.db);
      resetAllRateLimiters();

      const event = await seedEvent(testDb.db);
      const otherEvent = await seedEvent(testDb.db);
      eventId = event.id;
      otherEventId = otherEvent.id;

      const app = createTestApp();
      app.use('/queue', queueRoutes);
      server = await startServer(app);
      baseUrl = server.baseUrl;
    });

    it('includes the raised sync rate-limit headers', async () => {
      const res = await http.get(
        `${baseUrl}/queue/event/${eventId}?queue_type=seeding&sync=1`,
      );

      expect(res.status).toBe(200);
      expect(res.headers.has('ratelimit-limit')).toBe(true);
      expect(res.headers.get('ratelimit-limit')).toBe('120');
    });

    it('isolates sync limits per event id', async () => {
      for (let i = 0; i < 120; i++) {
        await http.get(
          `${baseUrl}/queue/event/${eventId}?queue_type=seeding&sync=1`,
        );
      }

      const blocked = await http.get<ErrorBody>(
        `${baseUrl}/queue/event/${eventId}?queue_type=seeding&sync=1`,
      );
      expect(blocked.status).toBe(429);
      expect(blocked.json.limiter).toBe('queueSync');

      const otherEventAllowed = await http.get(
        `${baseUrl}/queue/event/${otherEventId}?queue_type=seeding&sync=1`,
      );
      expect(otherEventAllowed.status).not.toBe(429);
    });

    it('isolates sync limits per queue type', async () => {
      for (let i = 0; i < 120; i++) {
        await http.get(
          `${baseUrl}/queue/event/${eventId}?queue_type=seeding&sync=1`,
        );
      }

      const blockedSeeding = await http.get<ErrorBody>(
        `${baseUrl}/queue/event/${eventId}?queue_type=seeding&sync=1`,
      );
      expect(blockedSeeding.status).toBe(429);

      const bracketAllowed = await http.get(
        `${baseUrl}/queue/event/${eventId}?queue_type=bracket&sync=1`,
      );
      expect(bracketAllowed.status).not.toBe(429);
    });

    it('skips the limiter for plain queue reads', async () => {
      const res = await http.get(
        `${baseUrl}/queue/event/${eventId}?queue_type=seeding`,
      );

      expect(res.status).toBe(200);
      expect(res.headers.has('ratelimit-limit')).toBe(false);
    });
  });

  // ==========================================================================
  // 429 response body contract
  // ==========================================================================
  describe('429 response body contract', () => {
    beforeEach(async () => {
      testDb = await createTestDb();
      __setTestDatabaseAdapter(testDb.db);
      resetAllRateLimiters();

      const app = createTestApp();
      app.use('/api', apiRoutes);
      server = await startServer(app);
      baseUrl = server.baseUrl;
    });

    it('returns a stable JSON structure on 429', async () => {
      for (let i = 0; i < 30; i++) {
        await http.post(`${baseUrl}/api/scores/submit`, {});
      }

      const res = await http.post<ErrorBody>(
        `${baseUrl}/api/scores/submit`,
        {},
      );
      expect(res.status).toBe(429);
      expect(res.json).toEqual(
        expect.objectContaining({
          error: 'rate_limit_exceeded',
          message: expect.any(String),
          limiter: 'scoreSubmit',
        }),
      );
    });
  });
});
