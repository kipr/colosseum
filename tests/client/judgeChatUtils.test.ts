import { describe, it, expect, beforeEach } from 'vitest';
import {
  computeHasUnread,
  computeConversationUnread,
  truncatePreview,
  groupMessagesByDate,
  mergeMessagesById,
  mergeMessagesForConversation,
  resolveRefreshedMessagesForConversation,
  selectedConversationWasRemoved,
  pageMayHaveOlderMessages,
  hasOlderMessagesForConversation,
  JUDGE_CHAT_NAME_KEY,
  JUDGE_CHAT_ADMIN_SEEN_KEY,
  judgeLastSeenKey,
  getJudgeDisplayName,
  setJudgeDisplayName,
  getJudgeLastSeen,
  setJudgeLastSeen,
  getAdminSeenMap,
  setAdminLastSeen,
  type JudgeChatConversation,
  type JudgeChatMessage,
} from '../../src/client/utils/judgeChatUtils';

function createLocalStorageMock() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
  };
}

describe('judgeChatUtils', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createLocalStorageMock(),
      configurable: true,
    });
    localStorage.clear();
  });

  describe('computeHasUnread', () => {
    it('returns false when no messages', () => {
      expect(computeHasUnread([], 0)).toBe(false);
    });

    it('returns true when latest id exceeds last seen', () => {
      const messages: JudgeChatMessage[] = [
        {
          id: 1,
          event_id: 1,
          conversation_key: 'k',
          sender_role: 'judge',
          sender_name: 'Judge',
          message: 'hi',
          template_id: null,
          user_id: null,
          created_at: '2026-01-01T12:00:00Z',
        },
        {
          id: 5,
          event_id: 1,
          conversation_key: 'k',
          sender_role: 'admin',
          sender_name: 'Admin',
          message: 'reply',
          template_id: null,
          user_id: 1,
          created_at: '2026-01-01T12:01:00Z',
        },
      ];
      expect(computeHasUnread(messages, 3)).toBe(true);
      expect(computeHasUnread(messages, 5)).toBe(false);
    });
  });

  describe('computeConversationUnread', () => {
    it('uses admin seen map per conversation key', () => {
      const map = { conv1: 10, conv2: 0 };
      expect(computeConversationUnread(12, 'conv1', map)).toBe(true);
      expect(computeConversationUnread(10, 'conv1', map)).toBe(false);
      expect(computeConversationUnread(1, 'conv2', map)).toBe(true);
      expect(computeConversationUnread(1, 'conv3', map)).toBe(true);
    });
  });

  describe('truncatePreview', () => {
    it('truncates long text with ellipsis', () => {
      const long = 'a'.repeat(70);
      expect(truncatePreview(long, 60).length).toBe(60);
      expect(truncatePreview(long, 60).endsWith('…')).toBe(true);
    });

    it('returns short text unchanged', () => {
      expect(truncatePreview('hello')).toBe('hello');
    });
  });

  describe('localStorage helpers', () => {
    it('stores and retrieves judge display name', () => {
      expect(getJudgeDisplayName()).toBeNull();
      setJudgeDisplayName('Alice Judge');
      expect(getJudgeDisplayName()).toBe('Alice Judge');
      expect(localStorage.getItem(JUDGE_CHAT_NAME_KEY)).toBe('Alice Judge');
    });

    it('stores and retrieves judge last seen per event', () => {
      expect(getJudgeLastSeen(42)).toBe(0);
      setJudgeLastSeen(42, 99);
      expect(getJudgeLastSeen(42)).toBe(99);
      expect(localStorage.getItem(judgeLastSeenKey(42))).toBe('99');
    });

    it('stores admin seen map by conversation key', () => {
      setAdminLastSeen('key-a', 7);
      setAdminLastSeen('key-b', 3);
      const map = getAdminSeenMap();
      expect(map['key-a']).toBe(7);
      expect(map['key-b']).toBe(3);
      expect(localStorage.getItem(JUDGE_CHAT_ADMIN_SEEN_KEY)).toBeTruthy();
    });
  });

  describe('mergeMessagesById', () => {
    const baseMessage = {
      event_id: 1,
      conversation_key: 'k',
      sender_role: 'judge' as const,
      sender_name: 'J',
      message: 'hello',
      template_id: null,
      user_id: null,
      created_at: '2026-06-08T12:00:00.000Z',
    };

    it('keeps optimistic local messages missing from the server response', () => {
      const server: JudgeChatMessage[] = [
        { id: 1, ...baseMessage, message: 'first' },
      ];
      const local: JudgeChatMessage[] = [
        { id: 1, ...baseMessage, message: 'first' },
        { id: 2, ...baseMessage, message: 'optimistic' },
      ];

      const merged = mergeMessagesById(server, local);
      expect(merged.map((m) => m.id)).toEqual([1, 2]);
    });

    it('prefers server copies when ids overlap', () => {
      const server: JudgeChatMessage[] = [
        { id: 1, ...baseMessage, message: 'server copy' },
      ];
      const local: JudgeChatMessage[] = [
        { id: 1, ...baseMessage, message: 'stale local copy' },
      ];

      const merged = mergeMessagesById(server, local);
      expect(merged[0].message).toBe('server copy');
    });
  });

  describe('mergeMessagesForConversation', () => {
    const baseMessage = {
      event_id: 1,
      sender_role: 'judge' as const,
      sender_name: 'J',
      message: 'hello',
      template_id: 1,
      user_id: null,
      created_at: '2026-06-08T12:00:00.000Z',
    };

    it('does not merge local messages from a different conversation', () => {
      const server: JudgeChatMessage[] = [
        { id: 3, ...baseMessage, conversation_key: 'thread-b', message: 'b1' },
      ];
      const local: JudgeChatMessage[] = [
        { id: 1, ...baseMessage, conversation_key: 'thread-a', message: 'a1' },
        { id: 2, ...baseMessage, conversation_key: 'thread-a', message: 'a2' },
      ];

      const merged = mergeMessagesForConversation(server, local, 'thread-b');
      expect(merged.map((m) => m.id)).toEqual([3]);
    });

    it('keeps optimistic messages for the active conversation', () => {
      const server: JudgeChatMessage[] = [
        { id: 1, ...baseMessage, conversation_key: 'thread-b', message: 'b1' },
      ];
      const local: JudgeChatMessage[] = [
        { id: 1, ...baseMessage, conversation_key: 'thread-b', message: 'b1' },
        { id: 2, ...baseMessage, conversation_key: 'thread-b', message: 'b2' },
      ];

      const merged = mergeMessagesForConversation(server, local, 'thread-b');
      expect(merged.map((m) => m.id)).toEqual([1, 2]);
    });
  });

  describe('resolveRefreshedMessagesForConversation', () => {
    const baseMessage = {
      event_id: 1,
      conversation_key: 'thread-b',
      sender_role: 'judge' as const,
      sender_name: 'J',
      message: 'hello',
      template_id: 1,
      user_id: null,
      created_at: '2026-06-08T12:00:00.000Z',
    };

    it('treats an empty server refresh as authoritative', () => {
      const local: JudgeChatMessage[] = [
        { id: 1, ...baseMessage, message: 'cached message' },
      ];

      const resolved = resolveRefreshedMessagesForConversation(
        [],
        local,
        'thread-b',
      );

      expect(resolved).toEqual([]);
    });

    it('preserves local messages only when the server returns messages', () => {
      const server: JudgeChatMessage[] = [
        { id: 1, ...baseMessage, message: 'server message' },
      ];
      const local: JudgeChatMessage[] = [
        { id: 1, ...baseMessage, message: 'cached message' },
        { id: 2, ...baseMessage, message: 'optimistic message' },
      ];

      const resolved = resolveRefreshedMessagesForConversation(
        server,
        local,
        'thread-b',
      );

      expect(resolved.map((m) => m.id)).toEqual([1, 2]);
      expect(resolved[0].message).toBe('server message');
    });
  });

  describe('selectedConversationWasRemoved', () => {
    const conversations: JudgeChatConversation[] = [
      {
        conversationKey: 'thread-a',
        messageCount: 1,
        lastMessageId: 1,
        lastActivity: '2026-06-08T12:00:00.000Z',
        lastMessage: 'hello',
        lastJudgeName: 'Judge A',
      },
    ];

    it('returns true when the selected conversation is missing', () => {
      expect(selectedConversationWasRemoved(conversations, 'thread-b')).toBe(
        true,
      );
    });

    it('returns false when no conversation is selected or the key remains', () => {
      expect(selectedConversationWasRemoved(conversations, null)).toBe(false);
      expect(selectedConversationWasRemoved(conversations, 'thread-a')).toBe(
        false,
      );
    });
  });

  describe('older message availability', () => {
    it('uses each conversation pagination state instead of message ids', () => {
      const secondConversationFirstMessage: JudgeChatMessage = {
        id: 42,
        event_id: 1,
        conversation_key: 'thread-b',
        sender_role: 'judge',
        sender_name: 'Judge B',
        message: 'only message in this thread',
        template_id: null,
        user_id: null,
        created_at: '2026-06-08T12:00:00.000Z',
      };
      const olderMessagesByConversation = { 'thread-a': true };

      expect(secondConversationFirstMessage.id).toBeGreaterThan(1);
      expect(
        hasOlderMessagesForConversation(
          olderMessagesByConversation,
          secondConversationFirstMessage.conversation_key,
        ),
      ).toBe(false);
    });

    it('marks only full pages as possibly having older messages', () => {
      expect(pageMayHaveOlderMessages(99, 100)).toBe(false);
      expect(pageMayHaveOlderMessages(100, 100)).toBe(true);
      expect(pageMayHaveOlderMessages(0, 100)).toBe(false);
    });
  });

  describe('groupMessagesByDate', () => {
    it('groups messages by formatted date label', () => {
      const today = new Date().toISOString();
      const messages: JudgeChatMessage[] = [
        {
          id: 1,
          event_id: 1,
          conversation_key: 'k',
          sender_role: 'judge',
          sender_name: 'J',
          message: 'a',
          template_id: null,
          user_id: null,
          created_at: today,
        },
      ];
      const groups = groupMessagesByDate(messages);
      expect(Object.keys(groups)).toContain('Today');
      expect(groups['Today']).toHaveLength(1);
    });
  });
});
