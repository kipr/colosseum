/**
 * HTTP route tests for /chat endpoints.
 * Covers public messaging, admin chat, and authorization.
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

async function seedChatMessage(
  db: TestDb['db'],
  data: {
    spreadsheet_id: string;
    sender_name: string;
    message: string;
    is_admin?: boolean;
    user_id?: number | null;
  },
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO chat_messages (spreadsheet_id, sender_name, message, is_admin, user_id)
     VALUES (?, ?, ?, ?, ?)`,
    [
      data.spreadsheet_id,
      data.sender_name,
      data.message,
      data.is_admin ?? false,
      data.user_id ?? null,
    ],
  );
  return { id: result.lastID! };
}

describe('Chat Routes', () => {
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
  // GET /chat/spreadsheets (public)
  // ==========================================================================

  describe('GET /chat/spreadsheets', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp();
      app.use('/chat', chatRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns empty array when no spreadsheets exist', async () => {
      const res = await http.get(`${server.baseUrl}/chat/spreadsheets`);
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });

    it('returns active spreadsheets', async () => {
      const user = await seedUser(testDb.db);
      await seedSpreadsheetConfig(testDb.db, {
        user_id: user.id,
        spreadsheet_id: 'sheet-1',
        spreadsheet_name: 'Main Sheet',
        sheet_name: 'Scores',
        is_active: true,
      });

      const res = await http.get(`${server.baseUrl}/chat/spreadsheets`);
      expect(res.status).toBe(200);
      const sheets = res.json as {
        spreadsheet_id: string;
        spreadsheet_name: string;
      }[];
      expect(sheets.length).toBe(1);
      expect(sheets[0].spreadsheet_id).toBe('sheet-1');
    });
  });

  // ==========================================================================
  // GET /chat/messages/:spreadsheetId (public)
  // ==========================================================================

  describe('GET /chat/messages/:spreadsheetId', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp();
      app.use('/chat', chatRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns empty array when no messages exist', async () => {
      const res = await http.get(
        `${server.baseUrl}/chat/messages/nonexistent`,
      );
      expect(res.status).toBe(200);
      expect(res.json).toEqual([]);
    });

    it('returns messages for a spreadsheet', async () => {
      await seedChatMessage(testDb.db, {
        spreadsheet_id: 'sheet-1',
        sender_name: 'Alice',
        message: 'Hello!',
      });
      await seedChatMessage(testDb.db, {
        spreadsheet_id: 'sheet-1',
        sender_name: 'Bob',
        message: 'Hi there!',
      });

      const res = await http.get(`${server.baseUrl}/chat/messages/sheet-1`);
      expect(res.status).toBe(200);
      const messages = res.json as { sender_name: string; message: string }[];
      expect(messages.length).toBe(2);
    });

    it('does not return messages from other spreadsheets', async () => {
      await seedChatMessage(testDb.db, {
        spreadsheet_id: 'sheet-1',
        sender_name: 'Alice',
        message: 'For sheet 1',
      });
      await seedChatMessage(testDb.db, {
        spreadsheet_id: 'sheet-2',
        sender_name: 'Bob',
        message: 'For sheet 2',
      });

      const res = await http.get(`${server.baseUrl}/chat/messages/sheet-1`);
      const messages = res.json as { message: string }[];
      expect(messages.length).toBe(1);
      expect(messages[0].message).toBe('For sheet 1');
    });

    it('respects the limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        await seedChatMessage(testDb.db, {
          spreadsheet_id: 'sheet-1',
          sender_name: 'User',
          message: `Message ${i}`,
        });
      }

      const res = await http.get(
        `${server.baseUrl}/chat/messages/sheet-1?limit=2`,
      );
      const messages = res.json as { message: string }[];
      expect(messages.length).toBe(2);
    });

    it('respects the before parameter for pagination', async () => {
      const m1 = await seedChatMessage(testDb.db, {
        spreadsheet_id: 'sheet-1',
        sender_name: 'A',
        message: 'First',
      });
      await seedChatMessage(testDb.db, {
        spreadsheet_id: 'sheet-1',
        sender_name: 'B',
        message: 'Second',
      });
      await seedChatMessage(testDb.db, {
        spreadsheet_id: 'sheet-1',
        sender_name: 'C',
        message: 'Third',
      });

      const res = await http.get(
        `${server.baseUrl}/chat/messages/sheet-1?before=${m1.id + 2}&limit=2`,
      );
      const messages = res.json as { id: number }[];
      expect(messages.length).toBeLessThanOrEqual(2);
    });
  });

  // ==========================================================================
  // POST /chat/messages (public)
  // ==========================================================================

  describe('POST /chat/messages', () => {
    let server: TestServerHandle;

    beforeEach(async () => {
      const app = createTestApp();
      app.use('/chat', chatRoutes);
      server = await startServer(app);
    });

    afterEach(async () => {
      await server.close();
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await http.post(`${server.baseUrl}/chat/messages`, {});
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Spreadsheet ID, sender name, and message are required',
      );
    });

    it('returns 400 when message is too long', async () => {
      const res = await http.post(`${server.baseUrl}/chat/messages`, {
        spreadsheetId: 'sheet-1',
        senderName: 'Alice',
        message: 'x'.repeat(1001),
      });
      expect(res.status).toBe(400);
      expect((res.json as { error: string }).error).toContain(
        'Message too long',
      );
    });

    it('creates a chat message', async () => {
      const res = await http.post(`${server.baseUrl}/chat/messages`, {
        spreadsheetId: 'sheet-1',
        senderName: 'Alice',
        message: 'Hello world',
      });

      expect(res.status).toBe(200);
      const msg = res.json as {
        id: number;
        sender_name: string;
        message: string;
        spreadsheet_id: string;
      };
      expect(msg.id).toBeGreaterThan(0);
      expect(msg.sender_name).toBe('Alice');
      expect(msg.message).toBe('Hello world');
      expect(msg.spreadsheet_id).toBe('sheet-1');
    });

    it('trims whitespace from sender name and message', async () => {
      const res = await http.post(`${server.baseUrl}/chat/messages`, {
        spreadsheetId: 'sheet-1',
        senderName: '  Alice  ',
        message: '  Hello  ',
      });

      expect(res.status).toBe(200);
      const msg = res.json as { sender_name: string; message: string };
      expect(msg.sender_name).toBe('Alice');
      expect(msg.message).toBe('Hello');
    });
  });

  // ==========================================================================
  // GET /chat/user-info (public)
  // ==========================================================================

  describe('GET /chat/user-info', () => {
    it('returns unauthenticated info when no user', async () => {
      const app = createTestApp();
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/chat/user-info`);
        expect(res.status).toBe(200);
        const info = res.json as {
          isAuthenticated: boolean;
          isAdmin: boolean;
          name: string | null;
        };
        expect(info.isAuthenticated).toBe(false);
        expect(info.isAdmin).toBe(false);
        expect(info.name).toBeNull();
      } finally {
        await server.close();
      }
    });

    it('returns authenticated info when user is present', async () => {
      const app = createTestApp({
        user: { id: 1, is_admin: true, name: 'Admin' },
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(`${server.baseUrl}/chat/user-info`);
        expect(res.status).toBe(200);
        const info = res.json as {
          isAuthenticated: boolean;
          isAdmin: boolean;
          name: string;
        };
        expect(info.isAuthenticated).toBe(true);
        expect(info.isAdmin).toBe(true);
        expect(info.name).toBe('Admin');
      } finally {
        await server.close();
      }
    });
  });

  // ==========================================================================
  // DELETE /chat/messages/:spreadsheetId (admin only)
  // ==========================================================================

  describe('DELETE /chat/messages/:spreadsheetId', () => {
    it('returns 401 when not authenticated', async () => {
      const app = createTestApp();
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.delete(
          `${server.baseUrl}/chat/messages/sheet-1`,
        );
        expect(res.status).toBe(401);
      } finally {
        await server.close();
      }
    });

    it('returns 403 when authenticated but not admin', async () => {
      const app = createTestApp({ user: { id: 1, is_admin: false } });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.delete(
          `${server.baseUrl}/chat/messages/sheet-1`,
        );
        expect(res.status).toBe(403);
      } finally {
        await server.close();
      }
    });

    it('clears all messages for admin', async () => {
      await seedChatMessage(testDb.db, {
        spreadsheet_id: 'sheet-1',
        sender_name: 'Alice',
        message: 'Hello',
      });
      await seedChatMessage(testDb.db, {
        spreadsheet_id: 'sheet-1',
        sender_name: 'Bob',
        message: 'Hi',
      });

      const app = createTestApp({ user: { id: 1, is_admin: true } });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.delete(
          `${server.baseUrl}/chat/messages/sheet-1`,
        );
        expect(res.status).toBe(200);
        const result = res.json as { success: boolean; message: string };
        expect(result.success).toBe(true);
        expect(result.message).toContain('Cleared 2 messages');
      } finally {
        await server.close();
      }
    });
  });

  // ==========================================================================
  // Admin Chat Endpoints
  // ==========================================================================

  describe('Admin Chat', () => {
    describe('GET /chat/admin/messages', () => {
      it('returns 401 when not authenticated', async () => {
        const app = createTestApp();
        app.use('/chat', chatRoutes);
        const server = await startServer(app);

        try {
          const res = await http.get(
            `${server.baseUrl}/chat/admin/messages`,
          );
          expect(res.status).toBe(401);
        } finally {
          await server.close();
        }
      });

      it('returns 403 when not admin', async () => {
        const app = createTestApp({ user: { id: 1, is_admin: false } });
        app.use('/chat', chatRoutes);
        const server = await startServer(app);

        try {
          const res = await http.get(
            `${server.baseUrl}/chat/admin/messages`,
          );
          expect(res.status).toBe(403);
        } finally {
          await server.close();
        }
      });

      it('returns admin messages for admin users', async () => {
        await seedChatMessage(testDb.db, {
          spreadsheet_id: '__ADMIN_ONLY__',
          sender_name: 'Admin1',
          message: 'Admin msg',
          is_admin: true,
        });

        const app = createTestApp({ user: { id: 1, is_admin: true } });
        app.use('/chat', chatRoutes);
        const server = await startServer(app);

        try {
          const res = await http.get(
            `${server.baseUrl}/chat/admin/messages`,
          );
          expect(res.status).toBe(200);
          const messages = res.json as { message: string }[];
          expect(messages.length).toBe(1);
          expect(messages[0].message).toBe('Admin msg');
        } finally {
          await server.close();
        }
      });
    });

    describe('POST /chat/admin/messages', () => {
      it('returns 401 when not authenticated', async () => {
        const app = createTestApp();
        app.use('/chat', chatRoutes);
        const server = await startServer(app);

        try {
          const res = await http.post(
            `${server.baseUrl}/chat/admin/messages`,
            { message: 'Test' },
          );
          expect(res.status).toBe(401);
        } finally {
          await server.close();
        }
      });

      it('returns 403 when not admin', async () => {
        const app = createTestApp({ user: { id: 1, is_admin: false } });
        app.use('/chat', chatRoutes);
        const server = await startServer(app);

        try {
          const res = await http.post(
            `${server.baseUrl}/chat/admin/messages`,
            { message: 'Test' },
          );
          expect(res.status).toBe(403);
        } finally {
          await server.close();
        }
      });

      it('returns 400 when message is missing', async () => {
        const user = await seedUser(testDb.db, { is_admin: true });
        const app = createTestApp({ user: { id: user.id, is_admin: true } });
        app.use('/chat', chatRoutes);
        const server = await startServer(app);

        try {
          const res = await http.post(
            `${server.baseUrl}/chat/admin/messages`,
            {},
          );
          expect(res.status).toBe(400);
        } finally {
          await server.close();
        }
      });

      it('returns 400 when message is too long', async () => {
        const user = await seedUser(testDb.db, { is_admin: true });
        const app = createTestApp({
          user: { id: user.id, is_admin: true, name: 'Admin' },
        });
        app.use('/chat', chatRoutes);
        const server = await startServer(app);

        try {
          const res = await http.post(
            `${server.baseUrl}/chat/admin/messages`,
            { message: 'x'.repeat(1001) },
          );
          expect(res.status).toBe(400);
          expect((res.json as { error: string }).error).toContain(
            'Message too long',
          );
        } finally {
          await server.close();
        }
      });

      it('posts an admin message', async () => {
        const user = await seedUser(testDb.db, {
          is_admin: true,
          name: 'Admin User',
        });
        const app = createTestApp({
          user: { id: user.id, is_admin: true, name: 'Admin User' },
        });
        app.use('/chat', chatRoutes);
        const server = await startServer(app);

        try {
          const res = await http.post(
            `${server.baseUrl}/chat/admin/messages`,
            { message: 'Admin broadcast' },
          );
          expect(res.status).toBe(200);
          const msg = res.json as {
            message: string;
            sender_name: string;
            is_admin: number;
          };
          expect(msg.message).toBe('Admin broadcast');
          expect(msg.sender_name).toBe('Admin User');
        } finally {
          await server.close();
        }
      });
    });

    describe('DELETE /chat/admin/messages', () => {
      it('returns 401 when not authenticated', async () => {
        const app = createTestApp();
        app.use('/chat', chatRoutes);
        const server = await startServer(app);

        try {
          const res = await http.delete(
            `${server.baseUrl}/chat/admin/messages`,
          );
          expect(res.status).toBe(401);
        } finally {
          await server.close();
        }
      });

      it('returns 403 when not admin', async () => {
        const app = createTestApp({ user: { id: 1, is_admin: false } });
        app.use('/chat', chatRoutes);
        const server = await startServer(app);

        try {
          const res = await http.delete(
            `${server.baseUrl}/chat/admin/messages`,
          );
          expect(res.status).toBe(403);
        } finally {
          await server.close();
        }
      });

      it('clears admin messages', async () => {
        await seedChatMessage(testDb.db, {
          spreadsheet_id: '__ADMIN_ONLY__',
          sender_name: 'Admin',
          message: 'Secret',
          is_admin: true,
        });

        const app = createTestApp({ user: { id: 1, is_admin: true } });
        app.use('/chat', chatRoutes);
        const server = await startServer(app);

        try {
          const res = await http.delete(
            `${server.baseUrl}/chat/admin/messages`,
          );
          expect(res.status).toBe(200);
          const result = res.json as { success: boolean };
          expect(result.success).toBe(true);
        } finally {
          await server.close();
        }
      });
    });
  });
});
