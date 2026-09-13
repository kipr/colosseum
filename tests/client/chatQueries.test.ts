// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useQuery } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import type {
  JudgeChatConversation,
  JudgeChatMessage,
} from '../../src/client/api/chat';
import { getChatMessages } from '../../src/client/api/chat';
import {
  JudgeChatProvider,
  useJudgeChat,
} from '../../src/client/contexts/JudgeChatContext';
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
import { removeJudgeQueries } from '../../src/client/queries/invalidation';
import { JUDGE_SESSION_GENERATION_STORAGE_KEY } from '../../src/client/utils/judgeSession';
import {
  createQueryWrapper,
  createTestQueryClient,
  jsonErrorResponse,
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

const conversation = (
  conversationKey: string,
  lastMessageId: number,
): JudgeChatConversation => ({
  conversationKey,
  messageCount: lastMessageId,
  lastMessageId,
  lastActivity: baseMessage.created_at,
  lastMessage: 'message',
  lastJudgeName: 'Judge',
});

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

  it('evicts message pages and refreshes the conversation list after deletion', async () => {
    let deleted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          deleted = true;
          return Promise.resolve(jsonResponse({ success: true }));
        }
        if (String(url).includes('/conversations')) {
          return Promise.resolve(
            jsonResponse(deleted ? [] : [conversation('thread-a', 2)]),
          );
        }
        return Promise.resolve(jsonResponse([]));
      }),
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
      conversation('thread-a', 2),
    ]);
    const { result } = renderHook(
      () => ({
        list: useQuery(chatConversationsQueryOptions(7, 4, false)),
        remove: useDeleteChatConversationMutation(),
      }),
      { wrapper: createQueryWrapper({ queryClient: client, router: false }) },
    );

    await act(async () => {
      await result.current.remove.mutateAsync({
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
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
  });

  it('leaves a stale conversation summary when refresh fails after deletion', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          return Promise.resolve(jsonResponse({ success: true }));
        }
        if (String(url).includes('/conversations')) {
          return Promise.resolve(jsonErrorResponse(500, 'Unavailable'));
        }
        return Promise.resolve(jsonResponse([]));
      }),
    );
    const client = createTestQueryClient();
    client.setQueryData(authUserKey, {
      id: 7,
      email: 'admin@kipr.org',
      isAdmin: true,
    });
    const summary = [conversation('thread-a', 2)];
    client.setQueryData(adminChatConversationsKey(7, 4), summary);
    const { result } = renderHook(
      () => ({
        list: useQuery(chatConversationsQueryOptions(7, 4, false)),
        remove: useDeleteChatConversationMutation(),
      }),
      { wrapper: createQueryWrapper({ queryClient: client, router: false }) },
    );

    await act(async () => {
      await result.current.remove.mutateAsync({
        mode: 'admin',
        userId: 7,
        eventId: 4,
        conversationKey: 'thread-a',
      });
    });

    await waitFor(() => expect(result.current.list.isError).toBe(true));
    expect(result.current.remove.isSuccess).toBe(true);
    expect(client.getQueryData(adminChatConversationsKey(7, 4))).toEqual(
      summary,
    );
  });

  it('keeps conversation deletion pending until list refresh attempts finish', async () => {
    let resolveRefresh!: (response: Response) => void;
    let deleted = false;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          deleted = true;
          return Promise.resolve(jsonResponse({ success: true }));
        }
        if (String(url).includes('/conversations')) {
          if (!deleted) {
            return Promise.resolve(jsonResponse([conversation('thread-a', 2)]));
          }
          return new Promise<Response>((resolve) => {
            resolveRefresh = resolve;
          });
        }
        return Promise.resolve(jsonResponse([]));
      }),
    );
    const client = createTestQueryClient();
    client.setQueryData(authUserKey, {
      id: 7,
      email: 'admin@kipr.org',
      isAdmin: true,
    });
    const { result } = renderHook(
      () => ({
        list: useQuery(chatConversationsQueryOptions(7, 4, false)),
        remove: useDeleteChatConversationMutation(),
      }),
      { wrapper: createQueryWrapper({ queryClient: client, router: false }) },
    );
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true));

    let finished = false;
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.remove.mutateAsync({
        mode: 'admin',
        userId: 7,
        eventId: 4,
        conversationKey: 'thread-a',
      });
      void pending.then(() => {
        finished = true;
      });
    });
    await waitFor(() => expect(resolveRefresh).toEqual(expect.any(Function)));
    expect(result.current.remove.isPending).toBe(true);
    expect(finished).toBe(false);
    resolveRefresh(jsonResponse([]));
    await act(async () => {
      await pending;
    });
    expect(finished).toBe(true);
    await waitFor(() => expect(result.current.remove.isSuccess).toBe(true));
    expect(client.getQueryData(adminChatConversationsKey(7, 4))).toEqual([]);
  });

  function renderAdminChat(client: ReturnType<typeof createTestQueryClient>) {
    const wrapper = ({ children }: { children: ReactNode }) => {
      const Inner = createQueryWrapper({ queryClient: client, router: false });
      return createElement(
        Inner,
        null,
        createElement(JudgeChatProvider, {
          mode: 'admin',
          userId: 7,
          eventId: 4,
          children,
        }),
      );
    };
    return renderHook(() => useJudgeChat(), { wrapper });
  }

  it('clears the deleted conversation selection after a failed list refresh', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          return Promise.resolve(jsonResponse({ success: true }));
        }
        if (String(url).includes('/conversations')) {
          return Promise.resolve(jsonErrorResponse(500, 'Unavailable'));
        }
        return Promise.resolve(jsonResponse([]));
      }),
    );
    const client = createTestQueryClient();
    client.setQueryData(authUserKey, {
      id: 7,
      email: 'admin@kipr.org',
      isAdmin: true,
    });
    const summary = [conversation('thread-a', 2)];
    client.setQueryData(adminChatConversationsKey(7, 4), summary);
    const { result } = renderAdminChat(client);
    act(() => {
      result.current.setSelectedConversationKey('thread-a');
    });
    await act(async () => {
      await expect(result.current.deleteConversation('thread-a')).resolves.toBe(
        true,
      );
    });
    expect(result.current.selectedConversationKey).toBeNull();
    expect(result.current.conversations).toEqual(summary);
  });

  it('does not clear a conversation selected while deletion is in flight', async () => {
    let resolveDelete!: (response: Response) => void;
    const summaries = [
      conversation('thread-a', 2),
      conversation('thread-b', 5),
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          return new Promise<Response>((resolve) => {
            resolveDelete = resolve;
          });
        }
        if (String(url).includes('/conversations')) {
          return Promise.resolve(jsonResponse(summaries));
        }
        return Promise.resolve(jsonResponse([]));
      }),
    );
    const client = createTestQueryClient();
    client.setQueryData(authUserKey, {
      id: 7,
      email: 'admin@kipr.org',
      isAdmin: true,
    });
    client.setQueryData(adminChatConversationsKey(7, 4), summaries);
    const { result } = renderAdminChat(client);
    act(() => {
      result.current.setSelectedConversationKey('thread-a');
    });
    let deleted = false;
    act(() => {
      void result.current.deleteConversation('thread-a').then((ok) => {
        deleted = ok;
      });
    });
    await waitFor(() => expect(resolveDelete).toEqual(expect.any(Function)));
    act(() => {
      result.current.setSelectedConversationKey('thread-b');
    });
    expect(result.current.selectedConversationKey).toBe('thread-b');
    resolveDelete(jsonResponse({ success: true }));
    await waitFor(() => expect(deleted).toBe(true));
    expect(result.current.selectedConversationKey).toBe('thread-b');
  });

  it('does not recreate evicted judge messages after session replacement', async () => {
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
    sessionStorage.setItem(
      JUDGE_SESSION_GENERATION_STORAGE_KEY,
      judgeScope.sessionGeneration,
    );
    client.setQueryData(judgeChatLatestKey(judgeScope.sessionGeneration, 4), [
      message(1),
    ]);
    const { result } = renderHook(() => useSendChatMessageMutation(false), {
      wrapper: createQueryWrapper({ queryClient: client, router: false }),
    });

    act(() => {
      result.current.mutate({
        ...judgeScope,
        message: 'late',
        senderName: 'Judge',
      });
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));
    sessionStorage.setItem(
      JUDGE_SESSION_GENERATION_STORAGE_KEY,
      'generation-3',
    );
    await removeJudgeQueries(client);
    resolveResponse(jsonResponse({ ...message(2), message: 'late' }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      client.getQueryData(judgeChatLatestKey(judgeScope.sessionGeneration, 4)),
    ).toBeUndefined();
  });

  it('does not restore deleted messages from a late in-flight read', async () => {
    let resolveLatest!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') {
          return Promise.resolve(jsonResponse({ success: true }));
        }
        return new Promise<Response>((resolve, reject) => {
          resolveLatest = resolve;
          init?.signal?.addEventListener('abort', () => {
            reject(
              new DOMException('This operation was aborted', 'AbortError'),
            );
          });
        });
      }),
    );
    const client = createTestQueryClient();
    client.setQueryData(authUserKey, {
      id: 7,
      email: 'admin@kipr.org',
      isAdmin: true,
    });
    const { result } = renderHook(
      () => ({
        latest: useQuery(chatLatestQueryOptions(adminScope, true)),
        remove: useDeleteChatConversationMutation(),
      }),
      { wrapper: createQueryWrapper({ queryClient: client, router: false }) },
    );
    await waitFor(() => expect(result.current.latest.isFetching).toBe(true));

    await act(async () => {
      await result.current.remove.mutateAsync({
        mode: 'admin',
        userId: 7,
        eventId: 4,
        conversationKey: 'thread-a',
      });
    });
    resolveLatest(jsonResponse([message(99)]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(
      client.getQueryData(adminChatLatestKey(7, 4, 'thread-a')),
    ).toBeUndefined();
  });

  it('clears older history when the latest page is authoritatively empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          String(url).includes('/conversations')
            ? jsonResponse([
                {
                  conversationKey: 'thread-a',
                  messageCount: 0,
                  lastMessageId: 0,
                  lastActivity: baseMessage.created_at,
                  lastMessage: null,
                  lastJudgeName: null,
                },
              ])
            : jsonResponse([]),
        ),
      ),
    );
    const client = createTestQueryClient();
    client.setQueryData(authUserKey, {
      id: 7,
      email: 'admin@kipr.org',
      isAdmin: true,
    });
    client.setQueryData(adminChatOlderKey(7, 4, 'thread-a'), {
      pages: [[message(1)]],
      pageParams: [2],
    });
    const wrapper = ({ children }: { children: ReactNode }) => {
      const Inner = createQueryWrapper({ queryClient: client, router: false });
      return createElement(
        Inner,
        null,
        createElement(JudgeChatProvider, {
          mode: 'admin',
          userId: 7,
          eventId: 4,
          children,
        }),
      );
    };
    const { result } = renderHook(() => useJudgeChat(), { wrapper });
    act(() => {
      result.current.setSelectedConversationKey('thread-a');
    });
    await waitFor(() => expect(result.current.messages).toEqual([]));
    await waitFor(() =>
      expect(
        client.getQueryData(adminChatOlderKey(7, 4, 'thread-a')),
      ).toBeUndefined(),
    );
  });
});
