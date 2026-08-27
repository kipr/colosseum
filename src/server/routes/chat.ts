import express, { Request, Response } from 'express';
import {
  AuthRequest,
  requireAuth,
  requireEventChatAccess,
  isJudgeSessionValidForEvent,
} from '../middleware/auth';
import { chatWriteLimiter, chatReadLimiter } from '../middleware/rateLimit';
import { getDatabase } from '../database/connection';

const router = express.Router();

/**
 * Normalize a `created_at` value coming from either SQLite (string without a
 * `Z` suffix) or PostgreSQL (Date object) into an ISO string.
 */
function normalizeTimestamp(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    return value.endsWith('Z') ? value : value.replace(' ', 'T') + 'Z';
  }
  return String(value);
}

// ==================== JUDGE CHAT (event-scoped, judge ↔ admin) ====================

interface JudgeChatMessage {
  id: number;
  event_id: number;
  conversation_key: string;
  sender_role: 'judge' | 'admin';
  sender_name: string;
  message: string;
  template_id: number | null;
  user_id: number | null;
  created_at: string | Date;
}

function fixJudgeTimestamp(
  msg: JudgeChatMessage,
): JudgeChatMessage & { created_at: string } {
  return { ...msg, created_at: normalizeTimestamp(msg.created_at) };
}

const JUDGE_CHAT_SELECT = `
  id, event_id, conversation_key, sender_role, sender_name, message,
  template_id, user_id, created_at
`;

const JUDGE_CHAT_MESSAGE_LIMIT_MAX = 100;
const JUDGE_CHAT_SENDER_NAME_MAX = 30;

function parsePositiveInt(
  value: unknown,
  field: string,
): number | { error: string } {
  const raw = Array.isArray(value) ? value[0] : value;
  if (raw == null || raw === '') {
    return { error: `Invalid ${field}` };
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { error: `Invalid ${field}` };
  }
  return parsed;
}

function parseMessagePagination(
  query: Request['query'],
): { limit: number; before?: number } | { error: string } {
  const limitRaw = query.limit ?? 100;
  const limitParsed = parsePositiveInt(limitRaw, 'limit');
  if (typeof limitParsed === 'object') {
    return limitParsed;
  }

  const limit = Math.min(limitParsed, JUDGE_CHAT_MESSAGE_LIMIT_MAX);
  const beforeRaw = query.before;
  if (beforeRaw == null || beforeRaw === '') {
    return { limit };
  }

  const beforeParsed = parsePositiveInt(beforeRaw, 'before');
  if (typeof beforeParsed === 'object') {
    return beforeParsed;
  }

  return { limit, before: beforeParsed };
}

function normalizeJudgeSenderName(provided: unknown): string {
  if (typeof provided !== 'string') return 'Judge';
  const trimmed = provided.trim();
  if (trimmed.length === 0) return 'Judge';
  return trimmed.slice(0, JUDGE_CHAT_SENDER_NAME_MAX);
}

function isAdminRequest(req: Request): boolean {
  const authReq = req as AuthRequest;
  return Boolean(authReq.isAuthenticated?.() && authReq.user?.is_admin);
}

// List conversations for an event (admin only).
router.get(
  '/events/:eventId/conversations',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      if (!isAdminRequest(req)) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const eventId = Number(req.params.eventId);
      if (!Number.isInteger(eventId)) {
        return res.status(400).json({ error: 'Invalid event id' });
      }

      const db = await getDatabase();

      // One aggregate row per conversation thread.
      const summaries = (await db.all(
        `SELECT
           conversation_key,
           COUNT(*) AS message_count,
           MAX(id) AS last_message_id,
           MAX(created_at) AS last_activity
         FROM judge_chat_messages
         WHERE event_id = ?
         GROUP BY conversation_key
         ORDER BY MAX(id) DESC`,
        [eventId],
      )) as {
        conversation_key: string;
        message_count: number;
        last_message_id: number;
        last_activity: string | Date;
      }[];

      const conversations = await Promise.all(
        summaries.map(async (summary) => {
          const lastMessage = (await db.get(
            `SELECT ${JUDGE_CHAT_SELECT} FROM judge_chat_messages WHERE id = ?`,
            [summary.last_message_id],
          )) as JudgeChatMessage | undefined;

          const lastJudge = (await db.get(
            `SELECT sender_name FROM judge_chat_messages
             WHERE event_id = ? AND conversation_key = ? AND sender_role = 'judge'
             ORDER BY id DESC LIMIT 1`,
            [eventId, summary.conversation_key],
          )) as { sender_name: string } | undefined;

          return {
            conversationKey: summary.conversation_key,
            messageCount: Number(summary.message_count),
            lastMessageId: summary.last_message_id,
            lastActivity: normalizeTimestamp(summary.last_activity),
            lastMessage: lastMessage ? lastMessage.message : null,
            lastJudgeName: lastJudge ? lastJudge.sender_name : null,
          };
        }),
      );

      res.json(conversations);
    } catch (error) {
      console.error('Error listing judge chat conversations:', error);
      res.status(500).json({ error: 'Failed to list conversations' });
    }
  },
);

// Get one conversation thread (judge: own thread; admin: ?conversationKey=).
router.get(
  '/events/:eventId/messages',
  chatReadLimiter,
  requireEventChatAccess,
  async (req: Request, res: Response) => {
    try {
      const eventId = Number(req.params.eventId);
      if (!Number.isInteger(eventId)) {
        return res.status(400).json({ error: 'Invalid event id' });
      }

      let conversationKey: string;
      const queryKey = req.query.conversationKey;
      const hasQueryKey = typeof queryKey === 'string' && queryKey.length > 0;

      if (hasQueryKey) {
        if (!isAdminRequest(req)) {
          return res.status(403).json({ error: 'Admin access required' });
        }
        conversationKey = queryKey;
      } else if (isJudgeSessionValidForEvent(req, eventId)) {
        conversationKey = req.session!.judgeAuth!.conversationKey;
      } else if (isAdminRequest(req)) {
        return res
          .status(400)
          .json({ error: 'conversationKey query parameter is required' });
      } else {
        return res.status(401).json({
          error: 'Judge session required. Please verify your access code.',
        });
      }

      const pagination = parseMessagePagination(req.query);
      if ('error' in pagination) {
        return res.status(400).json({ error: pagination.error });
      }

      const db = await getDatabase();

      let query = `
        SELECT ${JUDGE_CHAT_SELECT}
        FROM judge_chat_messages
        WHERE event_id = ? AND conversation_key = ?
      `;
      const params: (string | number)[] = [eventId, conversationKey];

      if (pagination.before != null) {
        query += ` AND id < ?`;
        params.push(pagination.before);
      }

      query += ` ORDER BY id DESC LIMIT ?`;
      params.push(pagination.limit);

      const messages = (await db.all(query, params)) as JudgeChatMessage[];
      // Reverse to chronological (oldest → newest) and normalize timestamps.
      res.json(messages.reverse().map(fixJudgeTimestamp));
    } catch (error) {
      console.error('Error fetching judge chat messages:', error);
      res.status(500).json({ error: 'Failed to fetch messages' });
    }
  },
);

// Post a message to a conversation (judge writes own thread; admin replies).
router.post(
  '/events/:eventId/messages',
  chatWriteLimiter,
  requireEventChatAccess,
  async (req: Request, res: Response) => {
    try {
      const eventId = Number(req.params.eventId);
      if (!Number.isInteger(eventId)) {
        return res.status(400).json({ error: 'Invalid event id' });
      }

      const { message } = req.body ?? {};
      if (
        !message ||
        typeof message !== 'string' ||
        message.trim().length === 0
      ) {
        return res.status(400).json({ error: 'Message is required' });
      }
      if (message.length > 1000) {
        return res
          .status(400)
          .json({ error: 'Message too long (max 1000 characters)' });
      }

      const db = await getDatabase();

      let conversationKey: string;
      let senderRole: 'judge' | 'admin';
      let senderName: string;
      let userId: number | null;
      let templateId: number | null;

      const bodyKey = req.body?.conversationKey;
      const hasBodyKey = typeof bodyKey === 'string' && bodyKey.length > 0;

      if (isJudgeSessionValidForEvent(req, eventId) && !hasBodyKey) {
        const judgeAuth = req.session!.judgeAuth!;
        conversationKey = judgeAuth.conversationKey;
        senderRole = 'judge';
        senderName = normalizeJudgeSenderName(req.body?.senderName);
        userId = null;
        templateId = judgeAuth.templateId ?? null;
      } else if (isAdminRequest(req)) {
        const authReq = req as AuthRequest;
        if (!hasBodyKey) {
          return res
            .status(400)
            .json({ error: 'conversationKey is required for admin replies' });
        }
        conversationKey = bodyKey;
        senderRole = 'admin';
        senderName = authReq.user.name || authReq.user.email || 'Admin';
        userId = authReq.user.id;
        templateId = null;
      } else if (isJudgeSessionValidForEvent(req, eventId)) {
        const judgeAuth = req.session!.judgeAuth!;
        conversationKey = judgeAuth.conversationKey;
        senderRole = 'judge';
        senderName = normalizeJudgeSenderName(req.body?.senderName);
        userId = null;
        templateId = judgeAuth.templateId ?? null;
      } else {
        return res.status(401).json({
          error: 'Judge session required. Please verify your access code.',
        });
      }

      const result = await db.run(
        `INSERT INTO judge_chat_messages
           (event_id, conversation_key, sender_role, sender_name, message, template_id, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          eventId,
          conversationKey,
          senderRole,
          senderName,
          message.trim(),
          templateId,
          userId,
        ],
      );

      const newMessage = (await db.get(
        `SELECT ${JUDGE_CHAT_SELECT} FROM judge_chat_messages WHERE id = ?`,
        [result.lastID],
      )) as JudgeChatMessage;

      res.json(fixJudgeTimestamp(newMessage));
    } catch (error) {
      console.error('Error posting judge chat message:', error);
      res.status(500).json({ error: 'Failed to post message' });
    }
  },
);

// Delete a single conversation thread (admin only).
router.delete(
  '/events/:eventId/conversations/:conversationKey',
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      if (!isAdminRequest(req)) {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const eventId = Number(req.params.eventId);
      if (!Number.isInteger(eventId)) {
        return res.status(400).json({ error: 'Invalid event id' });
      }
      const { conversationKey } = req.params;

      const db = await getDatabase();
      const result = await db.run(
        `DELETE FROM judge_chat_messages WHERE event_id = ? AND conversation_key = ?`,
        [eventId, conversationKey],
      );

      res.json({
        success: true,
        message: `Cleared ${result.changes} messages from conversation`,
      });
    } catch (error) {
      console.error('Error deleting judge chat conversation:', error);
      res.status(500).json({ error: 'Failed to delete conversation' });
    }
  },
);

export default router;
