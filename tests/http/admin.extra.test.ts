/**
 * Additional admin route tests targeting uncovered branches.
 * Covers Date instance handling in last_activity and error handler.
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
import { seedUser } from './helpers/seed';
import adminRoutes from '../../src/server/routes/admin';

describe('Admin Routes - additional coverage', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(async () => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  describe('GET /admin/users', () => {
    it('returns admin users with last_activity as string', async () => {
      const user = await seedUser(testDb.db, {
        is_admin: true,
        name: 'Active Admin',
      });

      // Set last_activity to a recent time (within 5 minutes)
      await testDb.db.run(
        'UPDATE users SET last_activity = CURRENT_TIMESTAMP WHERE id = ?',
        [user.id],
      );

      const app = createTestApp({ user: { id: user.id, is_admin: false } });
      app.use('/admin', adminRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/admin/users`);
        expect(res.status).toBe(200);
        const users = res.json as {
          id: number;
          isActive: boolean;
          isRecentlyActive: boolean;
          last_activity: string | null;
        }[];
        expect(users.length).toBeGreaterThanOrEqual(1);
        const admin = users.find((u) => u.id === user.id);
        expect(admin).toBeDefined();
        expect(admin!.last_activity).not.toBeNull();
        expect(admin!.isRecentlyActive).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('handles users with no last_activity', async () => {
      const user = await seedUser(testDb.db, {
        is_admin: true,
        name: 'Idle Admin',
      });

      // Explicitly clear last_activity
      await testDb.db.run(
        'UPDATE users SET last_activity = NULL WHERE id = ?',
        [user.id],
      );

      const app = createTestApp({ user: { id: user.id, is_admin: false } });
      app.use('/admin', adminRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/admin/users`);
        expect(res.status).toBe(200);
        const users = res.json as {
          id: number;
          isActive: boolean;
          isRecentlyActive: boolean;
          last_activity: string | null;
        }[];
        const admin = users.find((u) => u.id === user.id);
        expect(admin).toBeDefined();
        expect(admin!.isActive).toBe(false);
        expect(admin!.isRecentlyActive).toBe(false);
      } finally {
        await server.close();
      }
    });

    it('handles users with old last_activity (not active, not recently active)', async () => {
      const user = await seedUser(testDb.db, {
        is_admin: true,
        name: 'Old Admin',
      });

      // Set last_activity to 2 hours ago
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000)
        .toISOString()
        .replace('T', ' ')
        .replace('Z', '');
      await testDb.db.run('UPDATE users SET last_activity = ? WHERE id = ?', [
        twoHoursAgo,
        user.id,
      ]);

      const app = createTestApp({ user: { id: user.id, is_admin: false } });
      app.use('/admin', adminRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/admin/users`);
        expect(res.status).toBe(200);
        const users = res.json as {
          id: number;
          isActive: boolean;
          isRecentlyActive: boolean;
        }[];
        const admin = users.find((u) => u.id === user.id);
        expect(admin).toBeDefined();
        expect(admin!.isActive).toBe(false);
        expect(admin!.isRecentlyActive).toBe(false);
      } finally {
        await server.close();
      }
    });
  });
});
