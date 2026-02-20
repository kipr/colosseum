/**
 * HTTP route tests for /audit endpoints.
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
import { seedEvent, seedAuditLog, seedUser } from './helpers/seed';
import auditRoutes from '../../src/server/routes/audit';

describe('Audit Routes', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  const authUser = { id: 1, is_admin: false };

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const app = createTestApp({ user: authUser });
    app.use('/audit', auditRoutes);

    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  // ==========================================================================
  // Authentication
  // ==========================================================================

  describe('Authentication Boundaries', () => {
    it('GET /audit/event/:eventId returns 401 when not authenticated', async () => {
      const event = await seedEvent(testDb.db);
      const app = createTestApp();
      app.use('/audit', auditRoutes);
      const unauthServer = await startServer(app);

      try {
        const res = await http.get(
          `${unauthServer.baseUrl}/audit/event/${event.id}`,
        );
        expect(res.status).toBe(401);
        expect((res.json as { error: string }).error).toContain(
          'Authentication required',
        );
      } finally {
        await unauthServer.close();
      }
    });

    it('GET /audit/entity/:type/:id returns 401 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/audit', auditRoutes);
      const unauthServer = await startServer(app);

      try {
        const res = await http.get(
          `${unauthServer.baseUrl}/audit/entity/team/1`,
        );
        expect(res.status).toBe(401);
        expect((res.json as { error: string }).error).toContain(
          'Authentication required',
        );
      } finally {
        await unauthServer.close();
      }
    });
  });

  // ==========================================================================
  // GET /audit/event/:eventId
  // ==========================================================================

  describe('GET /audit/event/:eventId', () => {
    it('returns empty array when no audit logs exist', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.get(`${baseUrl}/audit/event/${event.id}`);

      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });

    it('returns only logs for the specified event', async () => {
      const event1 = await seedEvent(testDb.db);
      const event2 = await seedEvent(testDb.db, { name: 'Other Event' });

      await seedAuditLog(testDb.db, {
        event_id: event1.id,
        action: 'team_added',
        entity_type: 'team',
        entity_id: 1,
      });
      await seedAuditLog(testDb.db, {
        event_id: event2.id,
        action: 'score_submitted',
        entity_type: 'score',
        entity_id: 1,
      });

      const res = await http.get(`${baseUrl}/audit/event/${event1.id}`);

      expect(res.status).toBe(200);
      const logs = res.json as { event_id: number; action: string }[];
      expect(logs.length).toBe(1);
      expect(logs[0].event_id).toBe(event1.id);
      expect(logs[0].action).toBe('team_added');
    });

    it('filters by action when action query param is provided', async () => {
      const event = await seedEvent(testDb.db);
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'team_added',
        entity_type: 'team',
        entity_id: 1,
      });
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'score_submitted',
        entity_type: 'score',
        entity_id: 1,
      });

      const res = await http.get(
        `${baseUrl}/audit/event/${event.id}?action=team_added`,
      );

      expect(res.status).toBe(200);
      const logs = res.json as { action: string }[];
      expect(logs.length).toBe(1);
      expect(logs[0].action).toBe('team_added');
    });

    it('filters by entity_type when entity_type query param is provided', async () => {
      const event = await seedEvent(testDb.db);
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'team_added',
        entity_type: 'team',
        entity_id: 1,
      });
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'score_submitted',
        entity_type: 'score',
        entity_id: 1,
      });

      const res = await http.get(
        `${baseUrl}/audit/event/${event.id}?entity_type=score`,
      );

      expect(res.status).toBe(200);
      const logs = res.json as { entity_type: string }[];
      expect(logs.length).toBe(1);
      expect(logs[0].entity_type).toBe('score');
    });

    it('applies both action and entity_type filters when both provided', async () => {
      const event = await seedEvent(testDb.db);
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'team_added',
        entity_type: 'team',
        entity_id: 1,
      });
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'team_added',
        entity_type: 'team',
        entity_id: 2,
      });
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'score_submitted',
        entity_type: 'score',
        entity_id: 1,
      });

      const res = await http.get(
        `${baseUrl}/audit/event/${event.id}?action=team_added&entity_type=team`,
      );

      expect(res.status).toBe(200);
      const logs = res.json as { action: string; entity_type: string }[];
      expect(logs.length).toBe(2);
      expect(
        logs.every(
          (l) => l.action === 'team_added' && l.entity_type === 'team',
        ),
      ).toBe(true);
    });

    it('respects limit param', async () => {
      const event = await seedEvent(testDb.db);
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'test',
        entity_type: 'test',
        created_at: '2025-01-01 12:00:01',
      });
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'test',
        entity_type: 'test',
        created_at: '2025-01-01 12:00:02',
      });
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'test',
        entity_type: 'test',
        created_at: '2025-01-01 12:00:03',
      });

      const res = await http.get(`${baseUrl}/audit/event/${event.id}?limit=2`);

      expect(res.status).toBe(200);
      const logs = res.json as unknown[];
      expect(logs.length).toBe(2);
    });

    it('respects offset param', async () => {
      const event = await seedEvent(testDb.db);
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'test',
        entity_type: 'test',
        created_at: '2025-01-01 12:00:01',
      });
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'test',
        entity_type: 'test',
        created_at: '2025-01-01 12:00:02',
      });
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'test',
        entity_type: 'test',
        created_at: '2025-01-01 12:00:03',
      });

      const res = await http.get(
        `${baseUrl}/audit/event/${event.id}?limit=2&offset=1`,
      );

      expect(res.status).toBe(200);
      const logs = res.json as { created_at: string }[];
      expect(logs.length).toBe(2);
      // Order is DESC, so offset 1 skips the most recent
      expect(logs.map((l) => l.created_at)).not.toContain(
        '2025-01-01 12:00:03',
      );
    });
  });

  // ==========================================================================
  // GET /audit/entity/:type/:id
  // ==========================================================================

  describe('GET /audit/entity/:type/:id', () => {
    it('returns logs for the specified entity', async () => {
      const event = await seedEvent(testDb.db);
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'created',
        entity_type: 'team',
        entity_id: 42,
      });
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'updated',
        entity_type: 'team',
        entity_id: 42,
      });
      await seedAuditLog(testDb.db, {
        event_id: event.id,
        action: 'created',
        entity_type: 'team',
        entity_id: 99,
      });

      const res = await http.get(`${baseUrl}/audit/entity/team/42`);

      expect(res.status).toBe(200);
      const logs = res.json as { entity_type: string; entity_id: number }[];
      expect(logs.length).toBe(2);
      expect(
        logs.every((l) => l.entity_type === 'team' && l.entity_id === 42),
      ).toBe(true);
    });

    it('returns empty array when no logs exist for entity', async () => {
      const res = await http.get(`${baseUrl}/audit/entity/team/999`);

      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });

    it('respects limit param', async () => {
      const event = await seedEvent(testDb.db);
      for (let i = 0; i < 5; i++) {
        await seedAuditLog(testDb.db, {
          event_id: event.id,
          action: 'test',
          entity_type: 'team',
          entity_id: 1,
          created_at: `2025-01-01 12:00:0${i + 1}`,
        });
      }

      const res = await http.get(`${baseUrl}/audit/entity/team/1?limit=2`);

      expect(res.status).toBe(200);
      const logs = res.json as unknown[];
      expect(logs.length).toBe(2);
    });
  });

  // ==========================================================================
  // POST /audit - Create audit entry
  // ==========================================================================

  describe('POST /audit', () => {
    it('creates audit entry with required fields', async () => {
      const user = await seedUser(testDb.db);
      const event = await seedEvent(testDb.db);
      const app = createTestApp({ user: { id: user.id, is_admin: false } });
      app.use('/audit', auditRoutes);
      const postServer = await startServer(app);
      try {
        const res = await http.post(`${postServer.baseUrl}/audit`, {
          event_id: event.id,
          action: 'custom_action',
          entity_type: 'custom_entity',
          entity_id: 42,
          old_value: { before: true },
          new_value: { after: true },
        });

        expect(res.status).toBe(201);
        const body = res.json as { id: number; message: string };
        expect(body.id).toBeDefined();
        expect(body.message).toBe('Audit entry created');

        const log = await testDb.db.get(
          'SELECT * FROM audit_log WHERE id = ?',
          [body.id],
        );
        expect(log).toBeDefined();
        expect(log.event_id).toBe(event.id);
        expect(log.action).toBe('custom_action');
        expect(log.entity_type).toBe('custom_entity');
        expect(log.entity_id).toBe(42);
      } finally {
        await postServer.close();
      }
    });

    it('returns 400 when action is missing', async () => {
      const res = await http.post(`${baseUrl}/audit`, {
        entity_type: 'team',
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'action and entity_type are required',
      );
    });

    it('returns 400 when entity_type is missing', async () => {
      const res = await http.post(`${baseUrl}/audit`, {
        action: 'created',
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'action and entity_type are required',
      );
    });
  });
});
