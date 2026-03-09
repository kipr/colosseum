/**
 * HTTP route tests for admin-only event endpoints.
 * Verifies GET /events/public and GET /events/:id/public require admin.
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
import { seedEvent, seedUser } from './helpers/seed';
import eventsRoutes from '../../src/server/routes/events';

describe('Admin-only Events API (GET /events/public, GET /events/:id/public)', () => {
  let testDb: TestDb;
  let server: TestServerHandle;
  let baseUrl: string;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);

    const adminUser = await seedUser(testDb.db, { is_admin: true });
    const app = createTestApp({ user: { id: adminUser.id, is_admin: true } });
    app.use('/events', eventsRoutes);

    server = await startServer(app);
    baseUrl = server.baseUrl;
  });

  afterEach(async () => {
    await server.close();
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  describe('GET /events/public', () => {
    it('returns empty array when no events exist', async () => {
      const res = await http.get(`${baseUrl}/events/public`);
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });

    it('returns only active and complete events', async () => {
      await seedEvent(testDb.db, { name: 'Setup Event', status: 'setup' });
      await seedEvent(testDb.db, { name: 'Active Event', status: 'active' });
      await seedEvent(testDb.db, {
        name: 'Complete Event',
        status: 'complete',
      });
      await seedEvent(testDb.db, {
        name: 'Archived Event',
        status: 'archived',
      });

      const res = await http.get<{ name: string }[]>(
        `${baseUrl}/events/public`,
      );
      expect(res.status).toBe(200);

      const names = res.json.map((e) => e.name);
      expect(names).toContain('Active Event');
      expect(names).toContain('Complete Event');
      expect(names).not.toContain('Setup Event');
      expect(names).not.toContain('Archived Event');
    });

    it('returns only safe fields (no created_by, created_at, etc.)', async () => {
      await seedEvent(testDb.db, {
        name: 'Public Event',
        status: 'active',
        event_date: '2026-03-01',
        location: 'Test Arena',
        seeding_rounds: 4,
      });

      const res = await http.get<Record<string, unknown>[]>(
        `${baseUrl}/events/public`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toHaveLength(1);

      const event = res.json[0];
      expect(event).toHaveProperty('id');
      expect(event).toHaveProperty('name', 'Public Event');
      expect(event).toHaveProperty('status', 'active');
      expect(event).toHaveProperty('event_date', '2026-03-01');
      expect(event).toHaveProperty('location', 'Test Arena');
      expect(event).toHaveProperty('seeding_rounds', 4);

      expect(event).not.toHaveProperty('created_by');
      expect(event).not.toHaveProperty('created_at');
      expect(event).not.toHaveProperty('updated_at');
      expect(event).not.toHaveProperty('description');
      expect(event).not.toHaveProperty('score_accept_mode');
    });

    it('returns 403 when not authenticated', async () => {
      await seedEvent(testDb.db, { name: 'Test', status: 'active' });

      const app = createTestApp();
      app.use('/events', eventsRoutes);
      const unauthServer = await startServer(app);

      try {
        const res = await http.get(`${unauthServer.baseUrl}/events/public`);
        expect(res.status).toBe(403);
        expect((res.json as { error: string }).error).toContain('Admin');
      } finally {
        await unauthServer.close();
      }
    });

    it('returns 403 when authenticated but not admin', async () => {
      const nonAdminUser = await seedUser(testDb.db, {
        is_admin: false,
        google_id: 'google-non-admin',
      });
      const app = createTestApp({
        user: { id: nonAdminUser.id, is_admin: false },
      });
      app.use('/events', eventsRoutes);
      const nonAdminServer = await startServer(app);

      try {
        const res = await http.get(`${nonAdminServer.baseUrl}/events/public`);
        expect(res.status).toBe(403);
        expect((res.json as { error: string }).error).toContain('Admin');
      } finally {
        await nonAdminServer.close();
      }
    });
  });

  describe('GET /events/:id/public', () => {
    it('returns event public info by ID', async () => {
      const event = await seedEvent(testDb.db, {
        name: 'My Event',
        status: 'active',
        seeding_rounds: 5,
        location: 'Gym',
      });

      const res = await http.get<Record<string, unknown>>(
        `${baseUrl}/events/${event.id}/public`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toHaveProperty('id', event.id);
      expect(res.json).toHaveProperty('name', 'My Event');
      expect(res.json).toHaveProperty('status', 'active');
      expect(res.json).toHaveProperty('seeding_rounds', 5);
      expect(res.json).toHaveProperty('location', 'Gym');

      expect(res.json).not.toHaveProperty('created_by');
      expect(res.json).not.toHaveProperty('created_at');
      expect(res.json).not.toHaveProperty('updated_at');
    });

    it('returns 404 for nonexistent event', async () => {
      const res = await http.get(`${baseUrl}/events/99999/public`);
      expect(res.status).toBe(404);
    });

    it('returns event regardless of status (even setup/archived)', async () => {
      const event = await seedEvent(testDb.db, {
        name: 'Setup Event',
        status: 'setup',
      });

      const res = await http.get<Record<string, unknown>>(
        `${baseUrl}/events/${event.id}/public`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toHaveProperty('name', 'Setup Event');
    });

    it('returns 403 when not authenticated', async () => {
      const event = await seedEvent(testDb.db, {
        name: 'Test',
        status: 'active',
      });

      const app = createTestApp();
      app.use('/events', eventsRoutes);
      const unauthServer = await startServer(app);

      try {
        const res = await http.get(
          `${unauthServer.baseUrl}/events/${event.id}/public`,
        );
        expect(res.status).toBe(403);
        expect((res.json as { error: string }).error).toContain('Admin');
      } finally {
        await unauthServer.close();
      }
    });

    it('returns 403 when authenticated but not admin', async () => {
      const event = await seedEvent(testDb.db, {
        name: 'Test',
        status: 'active',
      });
      const nonAdminUser = await seedUser(testDb.db, {
        is_admin: false,
        google_id: 'google-non-admin',
      });
      const app = createTestApp({
        user: { id: nonAdminUser.id, is_admin: false },
      });
      app.use('/events', eventsRoutes);
      const nonAdminServer = await startServer(app);

      try {
        const res = await http.get(
          `${nonAdminServer.baseUrl}/events/${event.id}/public`,
        );
        expect(res.status).toBe(403);
        expect((res.json as { error: string }).error).toContain('Admin');
      } finally {
        await nonAdminServer.close();
      }
    });
  });
});
