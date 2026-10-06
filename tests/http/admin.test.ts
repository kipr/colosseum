/**
 * HTTP route tests for /api/admin endpoints.
 * Covers user listing and authorization.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../src/server/database/connection';
import { createTestApp, startServer, http } from './helpers/testServer';
import { seedUser } from './helpers/seed';
import { withNodeTimeZone } from '../sql/helpers/timeZone';
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

  describe('GET /api/admin/users', () => {
    it('returns 401 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/api/admin', adminRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/api/admin/users`);
        expect(res.status).toBe(401);
      } finally {
        await server.close();
      }
    });

    it('returns 200 for authenticated user', async () => {
      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/api/admin', adminRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/api/admin/users`);
        expect(res.status).toBe(200);
      } finally {
        await server.close();
      }
    });

    it('returns empty array when no admin users exist', async () => {
      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/api/admin', adminRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/api/admin/users`);
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
      app.use('/api/admin', adminRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/api/admin/users`);
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

    it('times activity correctly when Node runs outside the database time zone', async () => {
      const admin = await seedUser(testDb.db, { is_admin: true });
      await testDb.db.run(
        `UPDATE users SET last_activity = CURRENT_TIMESTAMP - INTERVAL '2 hours'
         WHERE id = ?`,
        [admin.id],
      );

      await withNodeTimeZone('America/Chicago', async () => {
        const app = createTestApp({ user: { id: admin.id, is_admin: true } });
        app.use('/api/admin', adminRoutes);
        const server = await startServer(app);

        try {
          const res = await http.get(`${server.baseUrl}/api/admin/users`);
          expect(res.status).toBe(200);
          const [user] = res.json as {
            last_activity: string;
            isActive: boolean;
            isRecentlyActive: boolean;
          }[];
          expect(user.isActive).toBe(false);
          expect(user.isRecentlyActive).toBe(false);
          const ageMs = Date.now() - Date.parse(user.last_activity);
          expect(Math.abs(ageMs - 2 * 60 * 60 * 1000)).toBeLessThan(60_000);
        } finally {
          await server.close();
        }
      });
    });
  });
});
