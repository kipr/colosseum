/**
 * HTTP route tests for /events endpoints.
 * Focuses on requireAuth/requireAdmin boundaries and error handling.
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

describe('Events Routes', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    // Create fresh in-memory DB with schema
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(async () => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  // ==========================================================================
  // Authentication and Authorization Tests
  // ==========================================================================

  describe('Authentication Boundaries', () => {
    describe('GET /events', () => {
      it('returns 401 when not authenticated', async () => {
        const app = createTestApp(); // No user = unauthenticated
        app.use('/events', eventsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.get(`${server.baseUrl}/events`);
          expect(res.status).toBe(401);
          expect((res.json as { error: string }).error).toContain(
            'Authentication required',
          );
        } finally {
          await server.close();
        }
      });

      it('returns 200 when authenticated (non-admin)', async () => {
        const app = createTestApp({ user: { id: 1, is_admin: false } });
        app.use('/events', eventsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.get(`${server.baseUrl}/events`);
          expect(res.status).toBe(200);
        } finally {
          await server.close();
        }
      });
    });

    describe('GET /events/:id', () => {
      it('returns 401 when not authenticated', async () => {
        const app = createTestApp();
        app.use('/events', eventsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.get(`${server.baseUrl}/events/1`);
          expect(res.status).toBe(401);
        } finally {
          await server.close();
        }
      });

      it('returns 200 when authenticated (non-admin)', async () => {
        const event = await seedEvent(testDb.db);
        const app = createTestApp({ user: { id: 1, is_admin: false } });
        app.use('/events', eventsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.get(`${server.baseUrl}/events/${event.id}`);
          expect(res.status).toBe(200);
        } finally {
          await server.close();
        }
      });
    });

    describe('POST /events (admin required)', () => {
      it('returns 403 when not authenticated', async () => {
        // requireAdmin returns 403 for all unauthorized access
        const app = createTestApp();
        app.use('/events', eventsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.post(`${server.baseUrl}/events`, {
            name: 'Test Event',
          });
          expect(res.status).toBe(403);
          expect((res.json as { error: string }).error).toContain(
            'Admin access required',
          );
        } finally {
          await server.close();
        }
      });

      it('returns 403 when authenticated but not admin', async () => {
        const app = createTestApp({ user: { id: 1, is_admin: false } });
        app.use('/events', eventsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.post(`${server.baseUrl}/events`, {
            name: 'Test Event',
          });
          expect(res.status).toBe(403);
          expect((res.json as { error: string }).error).toContain(
            'Admin access required',
          );
        } finally {
          await server.close();
        }
      });

      it('returns 201 when admin', async () => {
        // Seed a user for the created_by foreign key
        const user = await seedUser(testDb.db, { is_admin: true });
        const app = createTestApp({ user: { id: user.id, is_admin: true } });
        app.use('/events', eventsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.post(`${server.baseUrl}/events`, {
            name: 'Test Event',
          });
          expect(res.status).toBe(201);
        } finally {
          await server.close();
        }
      });
    });

    describe('PATCH /events/:id (admin required)', () => {
      it('returns 403 when not authenticated', async () => {
        // requireAdmin returns 403 for all unauthorized access
        const event = await seedEvent(testDb.db);
        const app = createTestApp();
        app.use('/events', eventsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.patch(`${server.baseUrl}/events/${event.id}`, {
            name: 'Updated',
          });
          expect(res.status).toBe(403);
        } finally {
          await server.close();
        }
      });

      it('returns 403 when authenticated but not admin', async () => {
        const event = await seedEvent(testDb.db);
        const app = createTestApp({ user: { id: 1, is_admin: false } });
        app.use('/events', eventsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.patch(`${server.baseUrl}/events/${event.id}`, {
            name: 'Updated',
          });
          expect(res.status).toBe(403);
        } finally {
          await server.close();
        }
      });

      it('returns 200 when admin', async () => {
        const event = await seedEvent(testDb.db);
        const app = createTestApp({ user: { id: 1, is_admin: true } });
        app.use('/events', eventsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.patch(`${server.baseUrl}/events/${event.id}`, {
            name: 'Updated Event',
          });
          expect(res.status).toBe(200);
        } finally {
          await server.close();
        }
      });
    });

    describe('DELETE /events/:id (admin required)', () => {
      it('returns 403 when not authenticated', async () => {
        // requireAdmin returns 403 for all unauthorized access
        const event = await seedEvent(testDb.db);
        const app = createTestApp();
        app.use('/events', eventsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.delete(`${server.baseUrl}/events/${event.id}`);
          expect(res.status).toBe(403);
        } finally {
          await server.close();
        }
      });

      it('returns 403 when authenticated but not admin', async () => {
        const event = await seedEvent(testDb.db);
        const app = createTestApp({ user: { id: 1, is_admin: false } });
        app.use('/events', eventsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.delete(`${server.baseUrl}/events/${event.id}`);
          expect(res.status).toBe(403);
        } finally {
          await server.close();
        }
      });

      it('returns 204 when admin', async () => {
        const event = await seedEvent(testDb.db);
        const app = createTestApp({ user: { id: 1, is_admin: true } });
        app.use('/events', eventsRoutes);
        const server = await startServer(app);

        try {
          const res = await http.delete(`${server.baseUrl}/events/${event.id}`);
          expect(res.status).toBe(204);
        } finally {
          await server.close();
        }
      });
    });
  });

  // ==========================================================================
  // GET /events
  // ==========================================================================

  describe('GET /events', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: { id: 1, is_admin: false } });
      app.use('/events', eventsRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns empty array when no events exist', async () => {
      const res = await http.get(`${server.baseUrl}/events`);

      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });

    it('returns all events', async () => {
      await seedEvent(testDb.db, { name: 'Event 1' });
      await seedEvent(testDb.db, { name: 'Event 2' });

      const res = await http.get(`${server.baseUrl}/events`);

      expect(res.status).toBe(200);
      const events = res.json as { name: string }[];
      expect(events.length).toBe(2);
    });

    it('filters by status', async () => {
      await seedEvent(testDb.db, { name: 'Setup Event', status: 'setup' });
      await seedEvent(testDb.db, { name: 'Active Event', status: 'active' });

      const res = await http.get(`${server.baseUrl}/events?status=active`);

      expect(res.status).toBe(200);
      const events = res.json as { name: string; status: string }[];
      expect(events.length).toBe(1);
      expect(events[0].status).toBe('active');
    });
  });

  // ==========================================================================
  // GET /events/:id
  // ==========================================================================

  describe('GET /events/:id', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: { id: 1, is_admin: false } });
      app.use('/events', eventsRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 404 when event not found', async () => {
      const res = await http.get(`${server.baseUrl}/events/999`);

      expect(res.status).toBe(404);
      expect((res.json as { error: string }).error).toContain(
        'Event not found',
      );
    });

    it('returns the event when found', async () => {
      const event = await seedEvent(testDb.db, {
        name: 'My Event',
        description: 'Description',
        location: 'Test Location',
      });

      const res = await http.get(`${server.baseUrl}/events/${event.id}`);

      expect(res.status).toBe(200);
      const result = res.json as {
        id: number;
        name: string;
        description: string;
        location: string;
      };
      expect(result.id).toBe(event.id);
      expect(result.name).toBe('My Event');
      expect(result.description).toBe('Description');
      expect(result.location).toBe('Test Location');
    });
  });

  // ==========================================================================
  // POST /events
  // ==========================================================================

  describe('POST /events', () => {
    let server: TestServerHandle;
    let userId: number;

    beforeEach(async () => {
      // Seed a user for the created_by foreign key constraint
      const user = await seedUser(testDb.db, { is_admin: true });
      userId = user.id;

      const app = createTestApp({ user: { id: userId, is_admin: true } });
      app.use('/events', eventsRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 400 when name is missing', async () => {
      const res = await http.post(`${server.baseUrl}/events`, {});

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'name is required',
      );
    });

    it('creates event with defaults', async () => {
      const res = await http.post(`${server.baseUrl}/events`, {
        name: 'New Event',
      });

      expect(res.status).toBe(201);
      const event = res.json as {
        id: number;
        name: string;
        status: string;
        seeding_rounds: number;
      };
      expect(event.id).toBeGreaterThan(0);
      expect(event.name).toBe('New Event');
      expect(event.status).toBe('setup'); // default status
      expect(event.seeding_rounds).toBe(3); // default seeding_rounds
    });

    it('creates event with custom values', async () => {
      const res = await http.post(`${server.baseUrl}/events`, {
        name: 'Custom Event',
        description: 'A description',
        event_date: '2026-03-15',
        location: 'Test Location',
        status: 'active',
        seeding_rounds: 5,
      });

      expect(res.status).toBe(201);
      const event = res.json as {
        name: string;
        description: string;
        event_date: string;
        location: string;
        status: string;
        seeding_rounds: number;
      };
      expect(event.name).toBe('Custom Event');
      expect(event.description).toBe('A description');
      expect(event.event_date).toBe('2026-03-15');
      expect(event.location).toBe('Test Location');
      expect(event.status).toBe('active');
      expect(event.seeding_rounds).toBe(5);
    });

    it('sets created_by to the authenticated user', async () => {
      const res = await http.post(`${server.baseUrl}/events`, {
        name: 'User Event',
      });

      expect(res.status).toBe(201);
      const event = res.json as { created_by: number };
      expect(event.created_by).toBe(userId);
    });
  });

  // ==========================================================================
  // PATCH /events/:id
  // ==========================================================================

  describe('PATCH /events/:id', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/events', eventsRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 400 when no valid fields provided', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.patch(`${server.baseUrl}/events/${event.id}`, {
        invalid_field: 'value',
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'No valid fields',
      );
    });

    it('returns 404 when event not found', async () => {
      const res = await http.patch(`${server.baseUrl}/events/999`, {
        name: 'Updated',
      });

      expect(res.status).toBe(404);
      expect((res.json as { error: string }).error).toContain(
        'Event not found',
      );
    });

    it('updates name successfully', async () => {
      const event = await seedEvent(testDb.db, { name: 'Original Name' });
      const res = await http.patch(`${server.baseUrl}/events/${event.id}`, {
        name: 'Updated Name',
      });

      expect(res.status).toBe(200);
      expect((res.json as { name: string }).name).toBe('Updated Name');
    });

    it('updates multiple fields', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.patch(`${server.baseUrl}/events/${event.id}`, {
        name: 'New Name',
        description: 'New Description',
        status: 'active',
      });

      expect(res.status).toBe(200);
      const result = res.json as {
        name: string;
        description: string;
        status: string;
      };
      expect(result.name).toBe('New Name');
      expect(result.description).toBe('New Description');
      expect(result.status).toBe('active');
    });

    it('returns 400 for invalid status value', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.patch(`${server.baseUrl}/events/${event.id}`, {
        status: 'invalid_status',
      });

      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain('Invalid status');
    });

    it('ignores non-allowed fields', async () => {
      const event = await seedEvent(testDb.db, { name: 'Original' });
      const res = await http.patch(`${server.baseUrl}/events/${event.id}`, {
        name: 'Updated',
        id: 999, // Should be ignored
        created_at: '2020-01-01', // Should be ignored
      });

      expect(res.status).toBe(200);
      const result = res.json as { id: number; name: string };
      expect(result.name).toBe('Updated');
      expect(result.id).toBe(event.id); // ID should not change
    });
  });

  // ==========================================================================
  // DELETE /events/:id
  // ==========================================================================

  describe('DELETE /events/:id', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/events', eventsRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 204 and deletes the event', async () => {
      const event = await seedEvent(testDb.db);
      const res = await http.delete(`${server.baseUrl}/events/${event.id}`);

      expect(res.status).toBe(204);

      // Verify event was deleted
      const getRes = await http.get(`${server.baseUrl}/events/${event.id}`);
      expect(getRes.status).toBe(404);
    });

    it('returns 204 even when event does not exist (idempotent)', async () => {
      const res = await http.delete(`${server.baseUrl}/events/999`);

      expect(res.status).toBe(204);
    });
  });
});
