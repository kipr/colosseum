/**
 * HTTP route tests for admin chat endpoints and public chat edge cases.
 * Targets uncovered admin chat routes in src/server/routes/chat.ts.
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
import { seedUser, seedSpreadsheetConfig } from './helpers/seed';
import chatRoutes from '../../src/server/routes/chat';

describe('Chat Admin Endpoints', () => {
  let testDb: TestDb;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
  });

  afterEach(async () => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  describe('GET /chat/admin/messages', () => {
    it('returns 403 when not admin', async () => {
      const user = await seedUser(testDb.db);
      const app = createTestApp({ user: { id: user.id, is_admin: false } });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/chat/admin/messages`);
        expect(res.status).toBe(403);
      } finally {
        await server.close();
      }
    });

    it('returns messages for admin', async () => {
      const user = await seedUser(testDb.db, { is_admin: true, name: 'Admin' });
      const app = createTestApp({
        user: { id: user.id, is_admin: true, name: 'Admin' },
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/chat/admin/messages`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.json)).toBe(true);
      } finally {
        await server.close();
      }
    });

    it('supports before parameter for pagination', async () => {
      const user = await seedUser(testDb.db, { is_admin: true, name: 'Admin' });
      const app = createTestApp({
        user: { id: user.id, is_admin: true, name: 'Admin' },
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/admin/messages?before=100`,
        );
        expect(res.status).toBe(200);
      } finally {
        await server.close();
      }
    });
  });

  describe('POST /chat/admin/messages', () => {
    it('returns 403 when not admin', async () => {
      const user = await seedUser(testDb.db);
      const app = createTestApp({ user: { id: user.id, is_admin: false } });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(`${server.baseUrl}/chat/admin/messages`, {
          message: 'Hello',
        });
        expect(res.status).toBe(403);
      } finally {
        await server.close();
      }
    });

    it('creates admin chat message', async () => {
      const user = await seedUser(testDb.db, { is_admin: true, name: 'Admin' });
      const app = createTestApp({
        user: { id: user.id, is_admin: true, name: 'Admin' },
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(`${server.baseUrl}/chat/admin/messages`, {
          message: 'Admin message',
        });
        expect(res.status).toBe(200);
        const body = res.json as { sender_name: string; message: string };
        expect(body.sender_name).toBe('Admin');
        expect(body.message).toBe('Admin message');
      } finally {
        await server.close();
      }
    });

    it('returns 400 when message is missing', async () => {
      const user = await seedUser(testDb.db, { is_admin: true, name: 'Admin' });
      const app = createTestApp({
        user: { id: user.id, is_admin: true, name: 'Admin' },
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(`${server.baseUrl}/chat/admin/messages`, {});
        expect(res.status).toBe(400);
      } finally {
        await server.close();
      }
    });

    it('returns 400 when message is too long', async () => {
      const user = await seedUser(testDb.db, { is_admin: true, name: 'Admin' });
      const app = createTestApp({
        user: { id: user.id, is_admin: true, name: 'Admin' },
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(`${server.baseUrl}/chat/admin/messages`, {
          message: 'a'.repeat(1001),
        });
        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain('too long');
      } finally {
        await server.close();
      }
    });
  });

  describe('DELETE /chat/admin/messages', () => {
    it('returns 403 when not admin', async () => {
      const user = await seedUser(testDb.db);
      const app = createTestApp({ user: { id: user.id, is_admin: false } });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.delete(`${server.baseUrl}/chat/admin/messages`);
        expect(res.status).toBe(403);
      } finally {
        await server.close();
      }
    });

    it('clears admin chat messages', async () => {
      const user = await seedUser(testDb.db, { is_admin: true, name: 'Admin' });
      const app = createTestApp({
        user: { id: user.id, is_admin: true, name: 'Admin' },
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        // Post a message first
        await http.post(`${server.baseUrl}/chat/admin/messages`, {
          message: 'To be cleared',
        });

        const res = await http.delete(`${server.baseUrl}/chat/admin/messages`);
        expect(res.status).toBe(200);
        expect((res.json as { success: boolean }).success).toBe(true);
      } finally {
        await server.close();
      }
    });
  });

  describe('Public chat - before parameter', () => {
    it('supports before parameter for message pagination', async () => {
      const user = await seedUser(testDb.db);
      const config = await seedSpreadsheetConfig(testDb.db, {
        user_id: user.id,
      });
      const app = createTestApp();
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/messages/${config.spreadsheet_id}?before=100`,
        );
        expect(res.status).toBe(200);
      } finally {
        await server.close();
      }
    });
  });

  describe('POST /chat/messages - message too long', () => {
    it('returns 400 when message exceeds 1000 chars', async () => {
      const app = createTestApp();
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(`${server.baseUrl}/chat/messages`, {
          spreadsheetId: 'test',
          senderName: 'Test',
          message: 'a'.repeat(1001),
        });
        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain('too long');
      } finally {
        await server.close();
      }
    });
  });

  describe('DELETE /chat/messages/:spreadsheetId - non-admin', () => {
    it('returns 403 when authenticated but not admin', async () => {
      const user = await seedUser(testDb.db);
      const app = createTestApp({ user: { id: user.id, is_admin: false } });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.delete(
          `${server.baseUrl}/chat/messages/test-spreadsheet`,
        );
        expect(res.status).toBe(403);
      } finally {
        await server.close();
      }
    });
  });
});
