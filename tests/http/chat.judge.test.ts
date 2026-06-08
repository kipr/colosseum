/**
 * HTTP route tests for the event-scoped judge chat endpoints under
 * /chat/events/:eventId. Covers judge-session authorization, event scoping,
 * admin access, no judge-to-judge visibility, and validation.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestDb, TestDb } from '../sql/helpers/testDb';
import { __setTestDatabaseAdapter } from '../../src/server/database/connection';
import {
  JUDGE_SESSION_TTL_MS,
  JudgeAuth,
} from '../../src/server/middleware/auth';
import {
  createTestApp,
  startServer,
  TestServerHandle,
  http,
} from './helpers/testServer';
import { seedUser, seedEvent, seedScoresheetTemplate } from './helpers/seed';
import chatRoutes from '../../src/server/routes/chat';

function judgeSession(overrides: Partial<JudgeAuth> = {}): JudgeAuth {
  const now = Date.now();
  return {
    templateId: 1,
    eventIds: [1],
    conversationKey: 'judge-conv-key',
    issuedAt: now,
    expiresAt: now + JUDGE_SESSION_TTL_MS,
    ...overrides,
  };
}

async function seedJudgeChatMessage(
  db: TestDb['db'],
  data: {
    event_id: number;
    conversation_key: string;
    sender_role: 'judge' | 'admin';
    sender_name: string;
    message: string;
    template_id?: number | null;
    user_id?: number | null;
  },
): Promise<{ id: number }> {
  const result = await db.run(
    `INSERT INTO judge_chat_messages
       (event_id, conversation_key, sender_role, sender_name, message, template_id, user_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      data.event_id,
      data.conversation_key,
      data.sender_role,
      data.sender_name,
      data.message,
      data.template_id ?? null,
      data.user_id ?? null,
    ],
  );
  return { id: result.lastID! };
}

describe('Judge Chat Routes', () => {
  let testDb: TestDb;
  let eventId: number;
  let templateId: number;

  beforeEach(async () => {
    testDb = await createTestDb();
    __setTestDatabaseAdapter(testDb.db);
    const event = await seedEvent(testDb.db);
    eventId = event.id;
    const template = await seedScoresheetTemplate(testDb.db);
    templateId = template.id;
  });

  afterEach(async () => {
    __setTestDatabaseAdapter(null);
    testDb.close();
  });

  // ==========================================================================
  // POST /chat/events/:eventId/messages (judge)
  // ==========================================================================

  describe('POST /chat/events/:eventId/messages (judge)', () => {
    it('creates a message in the judge own thread, key from session', async () => {
      const app = createTestApp({
        judgeSession: judgeSession({
          templateId,
          eventIds: [eventId],
          conversationKey: 'judge-A',
        }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
          { message: 'Hello admin', senderName: 'Judge Jane' },
        );
        expect(res.status).toBe(200);
        const msg = res.json as {
          id: number;
          conversation_key: string;
          sender_role: string;
          sender_name: string;
          message: string;
          template_id: number | null;
          user_id: number | null;
        };
        expect(msg.conversation_key).toBe('judge-A');
        expect(msg.sender_role).toBe('judge');
        expect(msg.sender_name).toBe('Judge Jane');
        expect(msg.message).toBe('Hello admin');
        expect(msg.template_id).toBe(templateId);
        expect(msg.user_id).toBeNull();
      } finally {
        await server.close();
      }
    });

    it('ignores a body conversationKey and uses the session key', async () => {
      const app = createTestApp({
        judgeSession: judgeSession({
          templateId,
          eventIds: [eventId],
          conversationKey: 'judge-A',
        }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
          { message: 'sneaky', conversationKey: 'someone-else' },
        );
        expect(res.status).toBe(200);
        const msg = res.json as { conversation_key: string };
        expect(msg.conversation_key).toBe('judge-A');
      } finally {
        await server.close();
      }
    });

    it('uses judge session when admin is also authenticated but no conversationKey is sent', async () => {
      const user = await seedUser(testDb.db, { is_admin: true, name: 'Admin' });
      const app = createTestApp({
        user: { id: user.id, is_admin: true, name: 'Admin' },
        judgeSession: judgeSession({
          templateId,
          eventIds: [eventId],
          conversationKey: 'judge-on-scoresheet',
        }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
          { message: 'from scoresheet', senderName: 'Admin Judge' },
        );
        expect(res.status).toBe(200);
        const msg = res.json as {
          conversation_key: string;
          sender_role: string;
          sender_name: string;
        };
        expect(msg.conversation_key).toBe('judge-on-scoresheet');
        expect(msg.sender_role).toBe('judge');
        expect(msg.sender_name).toBe('Admin Judge');
      } finally {
        await server.close();
      }
    });

    it('allows admin on scoresheet to read own thread without conversationKey query', async () => {
      await seedJudgeChatMessage(testDb.db, {
        event_id: eventId,
        conversation_key: 'judge-on-scoresheet',
        sender_role: 'judge',
        sender_name: 'Admin Judge',
        message: 'hello staff',
      });

      const user = await seedUser(testDb.db, { is_admin: true, name: 'Admin' });
      const app = createTestApp({
        user: { id: user.id, is_admin: true, name: 'Admin' },
        judgeSession: judgeSession({
          templateId,
          eventIds: [eventId],
          conversationKey: 'judge-on-scoresheet',
        }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
        );
        expect(res.status).toBe(200);
        const msgs = res.json as Array<{ message: string }>;
        expect(msgs).toHaveLength(1);
        expect(msgs[0].message).toBe('hello staff');
      } finally {
        await server.close();
      }
    });

    it('defaults sender_name to "Judge" when none provided', async () => {
      const app = createTestApp({
        judgeSession: judgeSession({ templateId, eventIds: [eventId] }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
          { message: 'anon' },
        );
        expect(res.status).toBe(200);
        expect((res.json as { sender_name: string }).sender_name).toBe('Judge');
      } finally {
        await server.close();
      }
    });

    it('returns 400 when message is missing', async () => {
      const app = createTestApp({
        judgeSession: judgeSession({ templateId, eventIds: [eventId] }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
          {},
        );
        expect(res.status).toBe(400);
      } finally {
        await server.close();
      }
    });

    it('returns 400 when message is too long', async () => {
      const app = createTestApp({
        judgeSession: judgeSession({ templateId, eventIds: [eventId] }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
          { message: 'x'.repeat(1001) },
        );
        expect(res.status).toBe(400);
        expect((res.json as { error: string }).error).toContain('too long');
      } finally {
        await server.close();
      }
    });
  });

  // ==========================================================================
  // Authorization / event scoping
  // ==========================================================================

  describe('event scoping and authorization', () => {
    it('returns 401 when no judge session and not authenticated', async () => {
      const app = createTestApp();
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
        );
        expect(res.status).toBe(401);
      } finally {
        await server.close();
      }
    });

    it('returns 403 when the eventId is not in the judge session', async () => {
      const app = createTestApp({
        judgeSession: judgeSession({ templateId, eventIds: [eventId + 999] }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
        );
        expect(res.status).toBe(403);
      } finally {
        await server.close();
      }
    });

    it('returns 401 when the judge session is expired', async () => {
      const app = createTestApp({
        judgeSession: judgeSession({
          templateId,
          eventIds: [eventId],
          issuedAt: Date.now() - JUDGE_SESSION_TTL_MS - 60_000,
          expiresAt: Date.now() - 60_000,
        }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
          { message: 'late' },
        );
        expect(res.status).toBe(401);
      } finally {
        await server.close();
      }
    });
  });

  // ==========================================================================
  // GET /chat/events/:eventId/messages (judge own thread only)
  // ==========================================================================

  describe('GET /chat/events/:eventId/messages (judge)', () => {
    it('returns only the judge own conversation, never other judges', async () => {
      await seedJudgeChatMessage(testDb.db, {
        event_id: eventId,
        conversation_key: 'judge-A',
        sender_role: 'judge',
        sender_name: 'Judge A',
        message: 'mine 1',
      });
      await seedJudgeChatMessage(testDb.db, {
        event_id: eventId,
        conversation_key: 'judge-A',
        sender_role: 'admin',
        sender_name: 'Admin',
        message: 'reply to A',
      });
      // Another judge's thread - must NOT be visible.
      await seedJudgeChatMessage(testDb.db, {
        event_id: eventId,
        conversation_key: 'judge-B',
        sender_role: 'judge',
        sender_name: 'Judge B',
        message: 'secret from B',
      });

      const app = createTestApp({
        judgeSession: judgeSession({
          templateId,
          eventIds: [eventId],
          conversationKey: 'judge-A',
        }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
        );
        expect(res.status).toBe(200);
        const messages = res.json as {
          conversation_key: string;
          message: string;
        }[];
        expect(messages.length).toBe(2);
        expect(messages.every((m) => m.conversation_key === 'judge-A')).toBe(
          true,
        );
        expect(messages.map((m) => m.message)).toEqual([
          'mine 1',
          'reply to A',
        ]);
      } finally {
        await server.close();
      }
    });

    it('supports before pagination', async () => {
      const first = await seedJudgeChatMessage(testDb.db, {
        event_id: eventId,
        conversation_key: 'judge-A',
        sender_role: 'judge',
        sender_name: 'Judge A',
        message: 'first',
      });
      await seedJudgeChatMessage(testDb.db, {
        event_id: eventId,
        conversation_key: 'judge-A',
        sender_role: 'judge',
        sender_name: 'Judge A',
        message: 'second',
      });

      const app = createTestApp({
        judgeSession: judgeSession({
          templateId,
          eventIds: [eventId],
          conversationKey: 'judge-A',
        }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/events/${eventId}/messages?before=${first.id + 1}`,
        );
        expect(res.status).toBe(200);
        const messages = res.json as { message: string }[];
        expect(messages.length).toBe(1);
        expect(messages[0].message).toBe('first');
      } finally {
        await server.close();
      }
    });

    it('returns 400 for invalid limit', async () => {
      const app = createTestApp({
        judgeSession: judgeSession({
          templateId,
          eventIds: [eventId],
          conversationKey: 'judge-A',
        }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/events/${eventId}/messages?limit=abc`,
        );
        expect(res.status).toBe(400);
      } finally {
        await server.close();
      }
    });

    it('returns 400 for invalid before', async () => {
      const app = createTestApp({
        judgeSession: judgeSession({
          templateId,
          eventIds: [eventId],
          conversationKey: 'judge-A',
        }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/events/${eventId}/messages?before=not-a-number`,
        );
        expect(res.status).toBe(400);
      } finally {
        await server.close();
      }
    });

    it('clamps limit to 100', async () => {
      for (let i = 0; i < 105; i++) {
        await seedJudgeChatMessage(testDb.db, {
          event_id: eventId,
          conversation_key: 'judge-A',
          sender_role: 'judge',
          sender_name: 'Judge A',
          message: `msg-${i}`,
        });
      }

      const app = createTestApp({
        judgeSession: judgeSession({
          templateId,
          eventIds: [eventId],
          conversationKey: 'judge-A',
        }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/events/${eventId}/messages?limit=9999`,
        );
        expect(res.status).toBe(200);
        const messages = res.json as unknown[];
        expect(messages.length).toBe(100);
      } finally {
        await server.close();
      }
    });

    it('truncates judge senderName server-side', async () => {
      const app = createTestApp({
        judgeSession: judgeSession({
          templateId,
          eventIds: [eventId],
          conversationKey: 'judge-A',
        }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.post(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
          {
            message: 'hello',
            senderName: 'A'.repeat(80),
          },
        );
        expect(res.status).toBe(200);
        const body = res.json as { sender_name: string };
        expect(body.sender_name).toHaveLength(30);
      } finally {
        await server.close();
      }
    });
  });

  // ==========================================================================
  // Admin: conversations list, reply, messages, delete
  // ==========================================================================

  describe('admin endpoints', () => {
    it('lists conversations for the event (admin only)', async () => {
      await seedJudgeChatMessage(testDb.db, {
        event_id: eventId,
        conversation_key: 'judge-A',
        sender_role: 'judge',
        sender_name: 'Judge A',
        message: 'hi from A',
      });
      await seedJudgeChatMessage(testDb.db, {
        event_id: eventId,
        conversation_key: 'judge-B',
        sender_role: 'judge',
        sender_name: 'Judge B',
        message: 'hi from B',
      });

      const user = await seedUser(testDb.db, { is_admin: true, name: 'Admin' });
      const app = createTestApp({
        user: { id: user.id, is_admin: true, name: 'Admin' },
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/events/${eventId}/conversations`,
        );
        expect(res.status).toBe(200);
        const convos = res.json as {
          conversationKey: string;
          messageCount: number;
          lastMessage: string;
          lastJudgeName: string;
        }[];
        expect(convos.length).toBe(2);
        const keys = convos.map((c) => c.conversationKey).sort();
        expect(keys).toEqual(['judge-A', 'judge-B']);
      } finally {
        await server.close();
      }
    });

    it('returns 403 when a judge tries to list conversations', async () => {
      const app = createTestApp({
        judgeSession: judgeSession({ templateId, eventIds: [eventId] }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/events/${eventId}/conversations`,
        );
        expect(res.status).toBe(401);
      } finally {
        await server.close();
      }
    });

    it('returns 403 when an authenticated non-admin lists conversations', async () => {
      const user = await seedUser(testDb.db, { is_admin: false });
      const app = createTestApp({ user: { id: user.id, is_admin: false } });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/events/${eventId}/conversations`,
        );
        expect(res.status).toBe(403);
      } finally {
        await server.close();
      }
    });

    it('requires conversationKey on admin GET messages', async () => {
      const user = await seedUser(testDb.db, { is_admin: true, name: 'Admin' });
      const app = createTestApp({
        user: { id: user.id, is_admin: true, name: 'Admin' },
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
        );
        expect(res.status).toBe(400);
      } finally {
        await server.close();
      }
    });

    it('admin reply requires conversationKey and lands in the judge thread', async () => {
      await seedJudgeChatMessage(testDb.db, {
        event_id: eventId,
        conversation_key: 'judge-A',
        sender_role: 'judge',
        sender_name: 'Judge A',
        message: 'need help',
      });

      const user = await seedUser(testDb.db, { is_admin: true, name: 'Admin' });
      const app = createTestApp({
        user: { id: user.id, is_admin: true, name: 'Admin' },
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const missing = await http.post(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
          { message: 'no key' },
        );
        expect(missing.status).toBe(400);

        const res = await http.post(
          `${server.baseUrl}/chat/events/${eventId}/messages`,
          { message: 'here is help', conversationKey: 'judge-A' },
        );
        expect(res.status).toBe(200);
        const msg = res.json as {
          conversation_key: string;
          sender_role: string;
          sender_name: string;
          user_id: number | null;
        };
        expect(msg.conversation_key).toBe('judge-A');
        expect(msg.sender_role).toBe('admin');
        expect(msg.sender_name).toBe('Admin');
        expect(msg.user_id).toBe(user.id);
      } finally {
        await server.close();
      }
    });

    it('admin can read a selected conversation by key', async () => {
      await seedJudgeChatMessage(testDb.db, {
        event_id: eventId,
        conversation_key: 'judge-A',
        sender_role: 'judge',
        sender_name: 'Judge A',
        message: 'visible',
      });
      await seedJudgeChatMessage(testDb.db, {
        event_id: eventId,
        conversation_key: 'judge-B',
        sender_role: 'judge',
        sender_name: 'Judge B',
        message: 'hidden',
      });

      const user = await seedUser(testDb.db, { is_admin: true, name: 'Admin' });
      const app = createTestApp({
        user: { id: user.id, is_admin: true, name: 'Admin' },
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.get(
          `${server.baseUrl}/chat/events/${eventId}/messages?conversationKey=judge-A`,
        );
        expect(res.status).toBe(200);
        const messages = res.json as { message: string }[];
        expect(messages.length).toBe(1);
        expect(messages[0].message).toBe('visible');
      } finally {
        await server.close();
      }
    });

    it('admin can delete a conversation thread', async () => {
      await seedJudgeChatMessage(testDb.db, {
        event_id: eventId,
        conversation_key: 'judge-A',
        sender_role: 'judge',
        sender_name: 'Judge A',
        message: 'one',
      });
      await seedJudgeChatMessage(testDb.db, {
        event_id: eventId,
        conversation_key: 'judge-A',
        sender_role: 'admin',
        sender_name: 'Admin',
        message: 'two',
      });

      const user = await seedUser(testDb.db, { is_admin: true, name: 'Admin' });
      const app = createTestApp({
        user: { id: user.id, is_admin: true, name: 'Admin' },
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.delete(
          `${server.baseUrl}/chat/events/${eventId}/conversations/judge-A`,
        );
        expect(res.status).toBe(200);
        const body = res.json as { success: boolean; message: string };
        expect(body.success).toBe(true);
        expect(body.message).toContain('Cleared 2 messages');

        const remaining = await testDb.db.all(
          `SELECT * FROM judge_chat_messages WHERE conversation_key = 'judge-A'`,
        );
        expect(remaining.length).toBe(0);
      } finally {
        await server.close();
      }
    });

    it('returns 403 when a judge tries to delete a conversation', async () => {
      const app = createTestApp({
        judgeSession: judgeSession({ templateId, eventIds: [eventId] }),
      });
      app.use('/chat', chatRoutes);
      const server = await startServer(app);

      try {
        const res = await http.delete(
          `${server.baseUrl}/chat/events/${eventId}/conversations/judge-A`,
        );
        expect(res.status).toBe(401);
      } finally {
        await server.close();
      }
    });
  });
});
