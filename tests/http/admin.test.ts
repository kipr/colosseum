/**
 * HTTP route tests for /admin endpoints.
 * Covers user listing and authorization.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../src/server/database/connection';
import {
  createTestApp,
  startServer,
  http,
} from './helpers/testServer';
import { seedUser } from './helpers/seed';
import adminRoutes from '../../src/server/routes/admin';

describe('Admin Routes', () => {
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
  // Authentication Boundaries
  // ==========================================================================

  describe('GET /admin/users', () => {
    it('returns 401 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/admin', adminRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/admin/users`);
        expect(res.status).toBe(401);
      } finally {
        await server.close();
      }
    });

    it('returns 200 for authenticated user', async () => {
      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/admin', adminRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/admin/users`);
        expect(res.status).toBe(200);
      } finally {
        await server.close();
      }
    });

    it('returns empty array when no admin users exist', async () => {
      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/admin', adminRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/admin/users`);
        expect(res.status).toBe(200);
        expect(res.json).toEqual([]);
      } finally {
        await server.close();
      }
    });

    it('returns admin users with activity status', async () => {
      await seedUser(testDb.db, {
        name: 'Admin One',
        email: 'admin1@example.com',
        google_id: 'google-admin-1',
        is_admin: true,
      });
      await seedUser(testDb.db, {
        name: 'Regular User',
        email: 'user@example.com',
        google_id: 'google-user-1',
        is_admin: false,
      });

      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/admin', adminRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/admin/users`);
        expect(res.status).toBe(200);
        const users = res.json as {
          name: string;
          email: string;
          is_admin: number;
          isActive: boolean;
          isRecentlyActive: boolean;
        }[];
        // Only admin users should be returned
        expect(users.length).toBe(1);
        expect(users[0].name).toBe('Admin One');
        expect(users[0].email).toBe('admin1@example.com');
        expect(typeof users[0].isActive).toBe('boolean');
        expect(typeof users[0].isRecentlyActive).toBe('boolean');
      } finally {
        await server.close();
      }
    });

    it('includes tokenValid field', async () => {
      await seedUser(testDb.db, {
        name: 'Admin',
        email: 'admin@example.com',
        is_admin: true,
      });

      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/admin', adminRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/admin/users`);
        expect(res.status).toBe(200);
        const users = res.json as { tokenValid: boolean }[];
        expect(users.length).toBe(1);
        expect(typeof users[0].tokenValid).toBe('boolean');
      } finally {
        await server.close();
      }
    });
  });
});
