// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JudgeChatMessage } from '../../src/client/api/chat';
import { getChatMessages } from '../../src/client/api/chat';
import {
  CHAT_ACTIVE_POLL_MS,
  CHAT_INACTIVE_POLL_MS,
  CHAT_PAGE_SIZE,
  chatConversationsQueryOptions,
  chatLatestKey,
  chatLatestQueryOptions,
  chatOlderKey,
  chatOlderQueryOptions,
  useDeleteChatConversationMutation,
  useSendChatMessageMutation,
  type ChatMessageScope,
} from '../../src/client/queries/chat';
import {
  adminChatConversationsKey,
  adminChatLatestKey,
  adminChatOlderKey,
  authUserKey,
  judgeChatLatestKey,
  judgeChatOlderKey,
} from '../../src/client/queries/keys';
import {
  createQueryWrapper,
  createTestQueryClient,
  jsonResponse,
  registerQueryTestCleanup,
} from './helpers/queryTestUtils';

registerQueryTestCleanup();

const baseMessage: Omit<JudgeChatMessage, 'id'> = {
  event_id: 4,
  conversation_key: 'thread-a',
  sender_role: 'judge',
  sender_name: 'Judge',
  message: 'message',
  template_id: null,
  user_id: null,
  created_at: '2026-09-13T10:00:00.000Z',
};

const message = (id: number): JudgeChatMessage => ({
  ...baseMessage,
  id,
});

const adminScope: ChatMessageScope = {
  mode: 'admin',
  userId: 7,
  eventId: 4,
  conversationKey: 'thread-a',
};
const judgeScope: ChatMessageScope = {
  mode: 'judge',
  sessionGeneration: 'generation-2',
  eventId: 4,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('chat query keys and policies', () => {
  it('isolates admin identity, event, and conversation', () => {
    expect(chatLatestKey(adminScope)).toEqual(
      adminChatLatestKey(7, 4, 'thread-a'),
    );
    expect(adminChatLatestKey(8, 4, 'thread-a')).not.toEqual(
      chatLatestKey(adminScope),
    );
    expect(adminChatLatestKey(7, 5, 'thread-a')).not.toEqual(
      chatLatestKey(adminScope),
    );
    expect(adminChatLatestKey(7, 4, 'thread-b')).not.toEqual(
      chatLatestKey(adminScope),
    );
    expect(chatOlderKey(adminScope)).toEqual(
      adminChatOlderKey(7, 4, 'thread-a'),
    );
  });

  it('isolates judge session generations without putting access codes in keys', () => {
    expect(chatLatestKey(judgeScope)).toEqual(
      judgeChatLatestKey('generation-2', 4),
    );
    expect(judgeChatLatestKey('generation-3', 4)).not.toEqual(
      chatLatestKey(judgeScope),
    );
    expect(chatOlderKey(judgeScope)).toEqual(
      judgeChatOlderKey('generation-2', 4),
    );
    expect(JSON.stringify(chatLatestKey(judgeScope))).not.toContain(
      'secret-access-code',
    );
  });

  it('uses active and inactive polling without polling older pages', () => {
    expect(chatLatestQueryOptions(judgeScope, true).refetchInterval).toBe(
      CHAT_ACTIVE_POLL_MS,
    );
    expect(chatLatestQueryOptions(judgeScope, false).refetchInterval).toBe(
      CHAT_INACTIVE_POLL_MS,
    );
    expect(chatConversationsQueryOptions(7, 4, true).refetchInterval).toBe(
      CHAT_ACTIVE_POLL_MS,
    );
    const older = chatOlderQueryOptions(judgeScope, 100);
    expect(older.enabled).toBe(false);
    expect(older.refetchInterval).toBeUndefined();
  });
});

describe('chat message pages', () => {
  it('retains messages displaced by the latest polling window', () => {
    const options = chatLatestQueryOptions(judgeScope, true);
    const share = options.structuralSharing;
    expect(typeof share).toBe('function');
    const previous = Array.from({ length: CHAT_PAGE_SIZE }, (_, index) =>
      message(index + 1),
    );
    const latest = Array.from({ length: CHAT_PAGE_SIZE }, (_, index) =>
      message(index + 2),
    );
    const merged = (share as (old: unknown, next: unknown) => unknown)(
      previous,
      latest,
    ) as JudgeChatMessage[];
    expect(merged.map((row) => row.id)).toEqual(
      Array.from({ length: CHAT_PAGE_SIZE + 1 }, (_, index) => index + 1),
    );
  });

  it('treats an empty latest response as authoritative', () => {
    const share = chatLatestQueryOptions(judgeScope, true).structuralSharing;
    const merged = (share as (old: unknown, next: unknown) => unknown)(
      [message(1)],
      [],
    );
    expect(merged).toEqual([]);
  });

  it('continues older pagination only after a full page', () => {
    const options = chatOlderQueryOptions(adminScope, 101);
    const nextPage = options.getNextPageParam;
    const fullPage = Array.from({ length: CHAT_PAGE_SIZE }, (_, index) =>
      message(index + 1),
    );
    expect(nextPage?.(fullPage, [fullPage], 101, [101])).toBe(1);
    expect(nextPage?.(fullPage.slice(1), [fullPage.slice(1)], 101, [101])).toBe(
      undefined,
    );
  });

  it('passes cancellation signals and scopes only admin requests by thread', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse([]))
      .mockResolvedValueOnce(jsonResponse([]));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    await getChatMessages(
      4,
      { conversationKey: 'thread/a', before: 50, limit: 100 },
      controller.signal,
    );
    await getChatMessages(4, { limit: 100 }, controller.signal);

    const [adminUrl, adminInit] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(adminUrl).toBe(
      '/chat/events/4/messages?conversationKey=thread%2Fa&before=50&limit=100',
    );
    expect(adminInit.signal).toBe(controller.signal);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      '/chat/events/4/messages?limit=100',
    );
  });

  it('keeps conversation and message caches under the same admin event scope', () => {
    expect(adminChatConversationsKey(7, 4).slice(0, 4)).toEqual(
      adminChatLatestKey(7, 4, 'thread-a').slice(0, 4),
    );
  });
});

describe('chat mutations', () => {
  it('updates only the originating admin thread after a delayed send', async () => {
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          }),
      ),
    );
    const client = createTestQueryClient();
    client.setQueryData(authUserKey, {
      id: 7,
      email: 'admin@kipr.org',
      isAdmin: true,
    });
    client.setQueryData(adminChatLatestKey(7, 4, 'thread-a'), [message(1)]);
    client.setQueryData(adminChatLatestKey(7, 4, 'thread-b'), [message(10)]);
    const { result } = renderHook(() => useSendChatMessageMutation(true), {
      wrapper: createQueryWrapper({ queryClient: client, router: false }),
    });

    act(() => {
      result.current.mutate({ ...adminScope, message: 'reply' });
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    resolveResponse(
      jsonResponse({
        ...message(2),
        sender_role: 'admin',
        sender_name: 'Admin',
        message: 'reply',
      }),
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(
      client
        .getQueryData<JudgeChatMessage[]>(adminChatLatestKey(7, 4, 'thread-a'))
        ?.map((row) => row.id),
    ).toEqual([1, 2]);
    expect(client.getQueryData(adminChatLatestKey(7, 4, 'thread-b'))).toEqual([
      message(10),
    ]);
  });

  it('does not update an old identity after a delayed send', async () => {
    let resolveResponse!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            resolveResponse = resolve;
          }),
      ),
    );
    const client = createTestQueryClient();
    client.setQueryData(authUserKey, {
      id: 7,
      email: 'old@kipr.org',
      isAdmin: true,
    });
    const { result } = renderHook(() => useSendChatMessageMutation(true), {
      wrapper: createQueryWrapper({ queryClient: client, router: false }),
    });

    act(() => {
      result.current.mutate({ ...adminScope, message: 'late reply' });
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    client.setQueryData(authUserKey, {
      id: 8,
      email: 'new@kipr.org',
      isAdmin: true,
    });
    resolveResponse(jsonResponse(message(2)));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      client.getQueryData(adminChatLatestKey(7, 4, 'thread-a')),
    ).toBeUndefined();
  });

  it('removes both page caches and the summary after deletion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ success: true }))),
    );
    const client = createTestQueryClient();
    client.setQueryData(authUserKey, {
      id: 7,
      email: 'admin@kipr.org',
      isAdmin: true,
    });
    client.setQueryData(adminChatLatestKey(7, 4, 'thread-a'), [message(2)]);
    client.setQueryData(adminChatOlderKey(7, 4, 'thread-a'), {
      pages: [[message(1)]],
      pageParams: [2],
    });
    client.setQueryData(adminChatConversationsKey(7, 4), [
      {
        conversationKey: 'thread-a',
        messageCount: 2,
        lastMessageId: 2,
        lastActivity: baseMessage.created_at,
        lastMessage: 'message',
        lastJudgeName: 'Judge',
      },
    ]);
    const { result } = renderHook(() => useDeleteChatConversationMutation(), {
      wrapper: createQueryWrapper({ queryClient: client, router: false }),
    });

    await act(async () => {
      await result.current.mutateAsync({
        mode: 'admin',
        userId: 7,
        eventId: 4,
        conversationKey: 'thread-a',
      });
    });

    expect(
      client.getQueryData(adminChatLatestKey(7, 4, 'thread-a')),
    ).toBeUndefined();
    expect(
      client.getQueryData(adminChatOlderKey(7, 4, 'thread-a')),
    ).toBeUndefined();
    expect(client.getQueryData(adminChatConversationsKey(7, 4))).toEqual([]);
  });
});
