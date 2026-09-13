// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  CancelledError,
  QueryClient,
  type QueryClientConfig,
} from '@tanstack/react-query';
import {
  ADMIN_ONLY_QUERY_META,
  canUpdateJudgeCache,
  invalidateEventDependents,
  invalidateQueueDependents,
  removeAdminOnlyQueries,
  removeAdminUserQueries,
  removeJudgeQueries,
} from '../../src/client/queries/invalidation';
import {
  adminChatConversationsKey,
  adminEventsKey,
  adminScopeKey,
  authUserKey,
  judgeScopeKey,
  publicEventsKey,
  queueKey,
  scoresKey,
} from '../../src/client/queries/keys';
import { JUDGE_SESSION_GENERATION_STORAGE_KEY } from '../../src/client/utils/judgeSession';
import { eventFive } from './helpers/sessionFixtures';

function clientWithData(options: QueryClientConfig = {}): QueryClient {
  return new QueryClient(options);
}

describe('query keys', () => {
  it('normalizes admin user ids to numbers', () => {
    expect(adminScopeKey('12')).toEqual(['admin', 12]);
    expect(adminEventsKey(12)).toEqual(['admin', 12, 'events']);
    expect(authUserKey).toEqual(['auth', 'user']);
    expect(judgeScopeKey).toEqual(['judge']);
  });
});

describe('removeAdminUserQueries', () => {
  it('removes only that user admin prefix', async () => {
    const queryClient = clientWithData();
    queryClient.setQueryData(adminEventsKey(1), [eventFive]);
    queryClient.setQueryData(adminEventsKey(2), [eventFive]);
    queryClient.setQueryData(publicEventsKey, [{ id: 99 }]);
    queryClient.setQueryData(authUserKey, { id: 1 });
    queryClient.setQueryData([...judgeScopeKey, 7, 'queue'], [{ id: 1 }]);

    removeAdminUserQueries(queryClient, 1);

    expect(queryClient.getQueryData(adminEventsKey(1))).toBeUndefined();
    expect(queryClient.getQueryData(adminEventsKey(2))).toEqual([eventFive]);
    expect(queryClient.getQueryData(publicEventsKey)).toEqual([{ id: 99 }]);
    expect(queryClient.getQueryData(authUserKey)).toEqual({ id: 1 });
    expect(queryClient.getQueryData([...judgeScopeKey, 7, 'queue'])).toEqual([
      { id: 1 },
    ]);
    queryClient.clear();
  });

  it('aborts in-flight reads when the admin prefix is removed', async () => {
    const queryClient = clientWithData({
      defaultOptions: { queries: { retry: false } },
    });
    let aborted = false;
    const pending = queryClient.fetchQuery({
      queryKey: adminEventsKey(1),
      queryFn: ({ signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            aborted = true;
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    });

    removeAdminUserQueries(queryClient, 1);

    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    expect(aborted).toBe(true);
    expect(queryClient.getQueryData(adminEventsKey(1))).toBeUndefined();
    queryClient.clear();
  });
});

describe('removeAdminOnlyQueries', () => {
  it('evicts admin-only entries without removing staff event lists', async () => {
    const queryClient = clientWithData();
    queryClient.setQueryData(adminEventsKey(1), [eventFive]);
    await queryClient.fetchQuery({
      queryKey: [...adminScopeKey(1), 'users'],
      queryFn: () => [{ id: 8 }],
      meta: ADMIN_ONLY_QUERY_META,
    });

    removeAdminOnlyQueries(queryClient, 1);

    expect(queryClient.getQueryData(adminEventsKey(1))).toEqual([eventFive]);
    expect(
      queryClient.getQueryData([...adminScopeKey(1), 'users']),
    ).toBeUndefined();
    queryClient.clear();
  });
});

describe('removeJudgeQueries', () => {
  it('removes judge entries on explicit logout cleanup', () => {
    const queryClient = clientWithData();
    queryClient.setQueryData([...judgeScopeKey, 3, 'queue'], [{ id: 1 }]);
    queryClient.setQueryData(publicEventsKey, [{ id: 99 }]);

    removeJudgeQueries(queryClient);

    expect(
      queryClient.getQueryData([...judgeScopeKey, 3, 'queue']),
    ).toBeUndefined();
    expect(queryClient.getQueryData(publicEventsKey)).toEqual([{ id: 99 }]);
    queryClient.clear();
  });
});

describe('canUpdateJudgeCache', () => {
  it('requires the stored session generation to match', () => {
    sessionStorage.setItem(JUDGE_SESSION_GENERATION_STORAGE_KEY, 'gen-1');
    expect(canUpdateJudgeCache('gen-1')).toBe(true);
    expect(canUpdateJudgeCache('gen-2')).toBe(false);
    sessionStorage.removeItem(JUDGE_SESSION_GENERATION_STORAGE_KEY);
    expect(canUpdateJudgeCache('gen-1')).toBe(false);
  });
});

describe('invalidateEventDependents', () => {
  it('marks the admin and public event prefixes stale without touching other events', async () => {
    const queryClient = clientWithData();
    queryClient.setQueryData(authUserKey, { id: 1, isAdmin: true });
    queryClient.setQueryData(scoresKey(1, 10), { rows: [] });
    queryClient.setQueryData(adminChatConversationsKey(1, 10), []);
    queryClient.setQueryData(adminEventsKey(1), [eventFive]);
    queryClient.setQueryData(publicEventsKey, [{ id: 10 }]);
    queryClient.setQueryData(scoresKey(1, 20), { rows: [] });
    await invalidateEventDependents(queryClient, { userId: 1, eventId: 10 });
    expect(queryClient.getQueryState(scoresKey(1, 10))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(adminChatConversationsKey(1, 10))
        ?.isInvalidated,
    ).toBe(true);
    expect(queryClient.getQueryState(publicEventsKey)?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(adminEventsKey(1))?.isInvalidated,
    ).not.toBe(true);
    expect(queryClient.getQueryState(scoresKey(1, 20))?.isInvalidated).not.toBe(
      true,
    );
    queryClient.clear();
  });
});

describe('invalidateQueueDependents', () => {
  it('refreshes queue entries without invalidating chat', async () => {
    const queryClient = clientWithData();
    queryClient.setQueryData(authUserKey, { id: 1, isAdmin: true });
    queryClient.setQueryData(queueKey(1, 10), []);
    queryClient.setQueryData(adminChatConversationsKey(1, 10), []);
    await invalidateQueueDependents(queryClient, { userId: 1, eventId: 10 });
    expect(queryClient.getQueryState(queueKey(1, 10))?.isInvalidated).toBe(
      true,
    );
    expect(
      queryClient.getQueryState(adminChatConversationsKey(1, 10))
        ?.isInvalidated,
    ).not.toBe(true);
    queryClient.clear();
  });
});
