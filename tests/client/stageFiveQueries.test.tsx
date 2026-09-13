// @vitest-environment jsdom
import {
  act,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from '@testing-library/react';
import { focusManager, useQuery } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import {
  createTestQueryClient,
  createQueryWrapper,
  jsonErrorResponse,
  jsonResponse,
  registerQueryTestCleanup,
  renderWithQuery,
} from './helpers/queryTestUtils';
import {
  authUserKey,
  awardsKey,
  bracketsKey,
  doubleSeedingKey,
  judgeEventKey,
  judgeScopeKey,
  normalizeQueueFilters,
  normalizeScoreListFilters,
  overallKey,
  queueKey,
  scoresKey,
  seedingKey,
} from '../../src/client/queries/keys';
import {
  scoresQueryOptions,
  useJudgeScoreSubmitMutation,
  useScoreMutations,
} from '../../src/client/queries/scores';
import {
  adminQueueQueryOptions,
  judgeQueueQueryOptions,
  useQueueMutations,
} from '../../src/client/queries/queue';
import { judgeTeamsQueryOptions } from '../../src/client/queries/teams';
import { judgeEventGamesQueryOptions } from '../../src/client/queries/brackets';
import { useVerifyTemplateMutation } from '../../src/client/queries/templates';
import {
  isScoreAcceptConflict,
  scoreAcceptConflictFrom,
} from '../../src/client/api/scores';
import { getEventQueue, QUEUE_STATUSES } from '../../src/client/api/queue';
import { getEventGames } from '../../src/client/api/brackets';
import { VERSIONED_GET_CACHE } from '../../src/client/api/http';
import AccessCodeModal from '../../src/client/components/AccessCodeModal';
import ScoresheetForm from '../../src/client/components/ScoresheetForm';
import type { TemplateDetail } from '../../src/client/api/templates';
import { POLL_INTERVAL_MS } from '../../src/client/queries/queryClient';

vi.mock('../../src/client/contexts/JudgeChatContext', () => ({
  JudgeChatProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('../../src/client/components/judgeChat/JudgeChatButton', () => ({
  default: () => null,
}));
vi.mock('../../src/client/components/judgeChat/JudgeChatDrawer', () => ({
  default: () => null,
}));

registerQueryTestCleanup();

const scorePage = {
  rows: [{ id: 1, template_id: 9, status: 'pending', score_data: {} }],
  page: 1,
  limit: 50,
  totalCount: 1,
  totalPages: 1,
};

function clientWithUser(user = { id: 1, isAdmin: true }) {
  const client = createTestQueryClient();
  client.setQueryData(authUserKey, user);
  return client;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const seedingTemplate: TemplateDetail = {
  id: 3,
  name: 'Seeding Sheet',
  description: null,
  created_at: '2026-01-01',
  schema: {
    title: 'Seeding Sheet',
    eventId: 10,
    scoreDestination: 'db',
    layout: 'two-column',
    fields: [
      {
        id: 'team_number',
        label: 'Team Number',
        type: 'dropdown',
        dataSource: {
          type: 'db',
          eventId: 10,
          labelField: 'team_number',
          valueField: 'team_number',
        },
        cascades: { targetField: 'team_name', sourceField: 'team_name' },
      },
      {
        id: 'alt_team',
        label: 'Alt Team',
        type: 'dropdown',
        dataSource: {
          type: 'db',
          eventId: 10,
          labelField: 'team_number',
          valueField: 'team_number',
        },
      },
      {
        id: 'team_name',
        label: 'Team Name',
        type: 'text',
        autoPopulated: true,
      },
      {
        id: 'round',
        label: 'Round',
        type: 'dropdown',
        options: [{ label: 'Round 1', value: '1' }],
      },
      {
        id: 'autonomous',
        label: 'Autonomous',
        type: 'number',
        column: 'left',
      },
      {
        id: 'total',
        label: 'Total',
        type: 'calculated',
        formula: 'autonomous',
        isGrandTotal: true,
      },
    ],
  },
};

describe('stage five score and queue keys', () => {
  it('isolates score pages by user, event, pagination, and filters', () => {
    const pageOne = scoresQueryOptions(1, 10, {
      page: 1,
      limit: 50,
      status: 'pending',
      scoreType: 'seeding',
    }).queryKey;
    expect(pageOne).toEqual([
      ...scoresKey(1, 10),
      normalizeScoreListFilters({
        page: 1,
        limit: 50,
        status: 'pending',
        scoreType: 'seeding',
      }),
    ]);
    expect(
      scoresQueryOptions(1, 10, {
        page: 2,
        limit: 50,
        status: 'pending',
        scoreType: 'seeding',
      }).queryKey,
    ).not.toEqual(pageOne);
    expect(
      scoresQueryOptions(2, 10, {
        page: 1,
        limit: 50,
        status: 'pending',
        scoreType: 'seeding',
      }).queryKey,
    ).not.toEqual(pageOne);
    expect(
      scoresQueryOptions(1, 11, {
        page: 1,
        limit: 50,
        status: 'pending',
        scoreType: 'seeding',
      }).queryKey,
    ).not.toEqual(pageOne);
    expect(
      scoresQueryOptions(1, 10, {
        page: 1,
        limit: 50,
        status: 'accepted',
        scoreType: 'seeding',
      }).queryKey,
    ).not.toEqual(pageOne);
  });

  it('normalizes queue filters so status order does not fork the cache', () => {
    const left = adminQueueQueryOptions(1, 10, {
      statuses: ['scored', 'queued'],
      queueType: 'seeding',
    }).queryKey;
    const right = adminQueueQueryOptions(1, 10, {
      statuses: ['queued', 'scored'],
      queueType: 'seeding',
    }).queryKey;
    expect(left).toEqual(right);
    expect(left[5]).toEqual(
      normalizeQueueFilters({
        statuses: ['queued', 'scored'],
        queueType: 'seeding',
      }),
    );
    expect(
      adminQueueQueryOptions(1, 10, {
        statuses: QUEUE_STATUSES,
        queueType: 'all',
      }).queryKey[5],
    ).toEqual(
      normalizeQueueFilters({
        statuses: QUEUE_STATUSES,
        queueType: null,
      }),
    );
  });

  it('keeps judge keys free of access codes', () => {
    const key = judgeQueueQueryOptions('gen-1', 10, {
      statuses: QUEUE_STATUSES,
      queueType: 'seeding',
    }).queryKey;
    expect(JSON.stringify(key)).not.toMatch(/access|secret|code-123/i);
    expect(key[0]).toBe('judge');
    expect(key[1]).toBe('gen-1');
    expect(judgeTeamsQueryOptions('gen-1', 10).queryKey).toEqual([
      ...judgeEventKey('gen-1', 10),
      'teams',
    ]);
  });
});

describe('stage five polling and versioned GETs', () => {
  it('polls scoring, queues, and judge games every 10s only while visible', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi
        .fn()
        .mockImplementation((url: string) =>
          Promise.resolve(
            String(url).includes('/scores/')
              ? jsonResponse(scorePage)
              : jsonResponse([]),
          ),
        );
      vi.stubGlobal('fetch', fetchMock);
      const client = clientWithUser();
      const hook = renderHook(
        () => {
          useQuery(scoresQueryOptions(1, 10, { page: 1, limit: 50 }));
          useQuery(
            adminQueueQueryOptions(1, 10, {
              statuses: QUEUE_STATUSES,
              queueType: 'all',
            }),
          );
          useQuery(
            judgeQueueQueryOptions('gen-1', 10, {
              statuses: QUEUE_STATUSES,
              queueType: 'seeding',
            }),
          );
          useQuery(
            judgeEventGamesQueryOptions('gen-1', 10, { complete: false }),
          );
        },
        { wrapper: createQueryWrapper({ queryClient: client }) },
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(fetchMock).toHaveBeenCalledTimes(4);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
      });
      expect(fetchMock).toHaveBeenCalledTimes(8);
      act(() => focusManager.setFocused(false));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
      });
      expect(fetchMock).toHaveBeenCalledTimes(8);
      hook.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps cached score rows visible while a later page is loading', async () => {
    const second = deferred<Response>();
    const fetchMock = vi.fn((url: string) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.searchParams.get('page') === '2') return second.promise;
      return Promise.resolve(
        jsonResponse({ ...scorePage, rows: [{ ...scorePage.rows[0], id: 1 }] }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = clientWithUser();
    const { result, rerender } = renderHook(
      ({ page }: { page: number }) =>
        useQuery(
          scoresQueryOptions(1, 10, {
            page,
            limit: 50,
            status: 'pending',
            scoreType: 'seeding',
          }),
        ),
      {
        wrapper: createQueryWrapper({ queryClient: client }),
        initialProps: { page: 1 },
      },
    );
    await waitFor(() => expect(result.current.data?.rows[0]?.id).toBe(1));
    rerender({ page: 2 });
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true));
    expect(result.current.data?.rows[0]?.id).toBe(1);
    second.resolve(jsonResponse({ ...scorePage, page: 2, rows: [] }));
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false));
    expect(result.current.data?.rows).toEqual([]);
  });

  it('cancels an in-flight score list when filters change', async () => {
    const first = deferred<Response>();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.searchParams.get('status') === 'accepted') {
        return Promise.resolve(jsonResponse({ ...scorePage, rows: [] }));
      }
      return new Promise<Response>((resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        });
        first.promise.then(resolve, reject);
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = clientWithUser();
    const { rerender } = renderHook(
      ({ status }: { status: string }) =>
        useQuery(scoresQueryOptions(1, 10, { page: 1, limit: 50, status })),
      {
        wrapper: createQueryWrapper({ queryClient: client }),
        initialProps: { status: 'pending' },
      },
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    rerender({ status: 'accepted' });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).includes('status=accepted'),
        ),
      ).toBe(true),
    );
    first.resolve(jsonResponse(scorePage));
    await waitFor(() =>
      expect(
        client.getQueryData(
          scoresQueryOptions(1, 10, {
            page: 1,
            limit: 50,
            status: 'accepted',
          }).queryKey,
        ),
      ).toEqual({ ...scorePage, rows: [] }),
    );
  });

  it('uses no-cache for versioned queue and event-game GETs', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])));
    vi.stubGlobal('fetch', fetchMock);
    await getEventQueue(10, { queueType: 'seeding', statuses: QUEUE_STATUSES });
    await getEventGames(10, { complete: false });
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ cache: VERSIONED_GET_CACHE }),
    );
    expect(fetchMock.mock.calls[1][1]).toEqual(
      expect.objectContaining({ cache: VERSIONED_GET_CACHE }),
    );
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      '/queue/event/10?queue_type=seeding',
    );
    expect(String(fetchMock.mock.calls[1][0])).toBe(
      '/brackets/event/10/games?eligible=scoreable',
    );
  });
});

describe('stage five mutations', () => {
  it('does not refresh a newly selected event after a delayed score write', async () => {
    const response = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response.promise),
    );
    const client = clientWithUser();
    client.setQueryData(
      scoresQueryOptions(1, 10, { page: 1, limit: 50 }).queryKey,
      scorePage,
    );
    client.setQueryData(
      scoresQueryOptions(1, 20, { page: 1, limit: 50 }).queryKey,
      scorePage,
    );
    const hook = renderHook(() => useScoreMutations(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    let result!: Promise<unknown>;
    act(() => {
      result = hook.result.current.accept.mutateAsync({
        userId: 1,
        eventId: 10,
        scoreId: 4,
      });
    });
    response.resolve(jsonResponse({ success: true }));
    await act(async () => {
      await result;
    });
    expect(
      client.getQueryState(
        scoresQueryOptions(1, 10, { page: 1, limit: 50 }).queryKey,
      )?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(
        scoresQueryOptions(1, 20, { page: 1, limit: 50 }).queryKey,
      )?.isInvalidated,
    ).not.toBe(true);
  });

  it('surfaces accept conflicts and retries with force', async () => {
    const fetchMock = vi.fn((url: string, options?: RequestInit) => {
      if (!String(url).includes('/accept-event')) {
        return Promise.resolve(jsonResponse(scorePage));
      }
      const body = JSON.parse(String(options?.body ?? '{}')) as {
        force?: boolean;
      };
      if (!body.force) {
        return Promise.resolve(jsonErrorResponse(409, 'Score already exists'));
      }
      return Promise.resolve(jsonResponse({ success: true, advanced: true }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = clientWithUser();
    const hook = renderHook(() => useScoreMutations(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    let caught: unknown;
    await act(async () => {
      try {
        await hook.result.current.accept.mutateAsync({
          userId: 1,
          eventId: 10,
          scoreId: 4,
        });
      } catch (error) {
        caught = error;
      }
    });
    expect(isScoreAcceptConflict(caught)).toBe(true);
    expect(scoreAcceptConflictFrom(caught as never).error).toMatch(/exists/i);
    await expect(
      hook.result.current.accept.mutateAsync({
        userId: 1,
        eventId: 10,
        scoreId: 4,
        force: true,
      }),
    ).resolves.toEqual({ success: true, advanced: true });
  });

  it('previews revert without invalidation, then confirms cascade dependents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) =>
        Promise.resolve(
          String(url).includes('/revert-event')
            ? jsonResponse({
                requiresConfirmation: true,
                affectedGames: [{ id: 2, game_number: 4, roundName: 'Semis' }],
                revertedGames: 1,
              })
            : jsonResponse(scorePage),
        ),
      ),
    );
    const client = clientWithUser();
    client.setQueryData(seedingKey(1, 10), []);
    client.setQueryData(bracketsKey(1, 10), []);
    const hook = renderHook(() => useScoreMutations(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    await act(async () => {
      await hook.result.current.previewRevert.mutateAsync({
        userId: 1,
        eventId: 10,
        scoreId: 4,
      });
    });
    expect(client.getQueryState(seedingKey(1, 10))?.isInvalidated).not.toBe(
      true,
    );
    await act(async () => {
      await hook.result.current.revert.mutateAsync({
        userId: 1,
        eventId: 10,
        scoreId: 4,
      });
    });
    expect(client.getQueryState(seedingKey(1, 10))?.isInvalidated).toBe(true);
    expect(client.getQueryState(bracketsKey(1, 10))?.isInvalidated).toBe(true);
  });

  it('treats partial bulk acceptance as success and refreshes derived results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            accepted: 1,
            skipped: [{ id: 2, reason: 'conflict' }],
          }),
        ),
      ),
    );
    const client = clientWithUser();
    client.setQueryData(overallKey(1, 10), []);
    client.setQueryData(awardsKey(1, 10), []);
    const hook = renderHook(() => useScoreMutations(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    let result!: { accepted: number; skipped?: { id: number }[] };
    await act(async () => {
      result = await hook.result.current.bulkAccept.mutateAsync({
        userId: 1,
        eventId: 10,
        scoreIds: [1, 2],
      });
    });
    expect(result.accepted).toBe(1);
    expect(result.skipped).toHaveLength(1);
    expect(client.getQueryState(overallKey(1, 10))?.isInvalidated).toBe(true);
  });

  it('keeps a successful write when a later refresh fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, options) =>
        Promise.resolve(
          options?.method && options.method !== 'GET'
            ? jsonResponse({ success: true })
            : jsonErrorResponse(500),
        ),
      ),
    );
    const client = clientWithUser();
    client.setQueryData(queueKey(1, 10), []);
    client.setQueryData(
      scoresQueryOptions(1, 10, { page: 1, limit: 50 }).queryKey,
      scorePage,
    );
    const hook = renderHook(
      () => ({
        query: useQuery(scoresQueryOptions(1, 10, { page: 1, limit: 50 })),
        ...useScoreMutations(),
      }),
      { wrapper: createQueryWrapper({ queryClient: client }) },
    );
    await act(async () => {
      await hook.result.current.reject.mutateAsync({
        userId: 1,
        eventId: 10,
        scoreId: 4,
      });
    });
    expect(
      client.getQueryState(
        scoresQueryOptions(1, 10, { page: 1, limit: 50 }).queryKey,
      )?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryState(queueKey(1, 10))?.isInvalidated).toBe(true);
  });

  it('evicts the previous judge namespace after verification', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse(seedingTemplate))),
    );
    const client = clientWithUser();
    const oldKey = [...judgeScopeKey, 'old-gen', 'event', 10, 'queue'];
    client.setQueryData(oldKey, [{ id: 1 }]);
    const hook = renderHook(() => useVerifyTemplateMutation(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    await act(async () => {
      await hook.result.current.mutateAsync({
        templateId: 3,
        accessCode: 'secret-code',
      });
    });
    expect(client.getQueryData(oldKey)).toBeUndefined();
  });

  it('invalidates only the originating judge session after submit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({ id: 8, status: 'accepted', score_data: {} }),
        ),
      ),
    );
    const client = clientWithUser();
    const currentQueue = [...judgeEventKey('gen-1', 10), 'queue'];
    const otherQueue = [...judgeEventKey('gen-2', 10), 'queue'];
    client.setQueryData(currentQueue, [{ id: 1 }]);
    client.setQueryData(otherQueue, [{ id: 2 }]);
    client.setQueryData(doubleSeedingKey(1, 10), []);
    const hook = renderHook(() => useJudgeScoreSubmitMutation(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    await act(async () => {
      await hook.result.current.mutateAsync({
        sessionGeneration: 'gen-1',
        templateId: 3,
        participantName: 'A',
        matchId: '1',
        scoreData: {},
        isHeadToHead: false,
        eventId: 10,
        scoreType: 'seeding',
      });
    });
    expect(client.getQueryState(currentQueue)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherQueue)?.isInvalidated).not.toBe(true);
    expect(client.getQueryState(doubleSeedingKey(1, 10))?.isInvalidated).toBe(
      true,
    );
  });

  it('does not send access codes or session generation on queue writes', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse({ id: 1 })));
    vi.stubGlobal('fetch', fetchMock);
    const client = clientWithUser();
    const hook = renderHook(() => useQueueMutations(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    await act(async () => {
      await hook.result.current.add.mutateAsync({
        userId: 1,
        eventId: 10,
        event_id: 10,
        queue_type: 'seeding',
        seeding_team_id: 4,
        seeding_round: 1,
      });
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body).toEqual({
      event_id: 10,
      queue_type: 'seeding',
      seeding_team_id: 4,
      seeding_round: 1,
    });
  });
});

describe('stage five judge UI', () => {
  it('keeps an invalid access code in the field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(jsonErrorResponse(403, 'Invalid access code')),
      ),
    );
    const onSuccess = vi.fn();
    renderWithQuery(
      <AccessCodeModal
        templateId={3}
        templateName="Seeding Sheet"
        onClose={() => undefined}
        onSuccess={onSuccess}
      />,
    );
    const input = screen.getByPlaceholderText(
      'Enter code provided by administrator',
    );
    fireEvent.change(input, { target: { value: 'wrong-code' } });
    fireEvent.click(screen.getByRole('button', { name: 'Access Scoresheet' }));
    await screen.findByText('Invalid access code');
    expect((input as HTMLInputElement).value).toBe('wrong-code');
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('deduplicates judge team reads for one event and keeps the draft on refresh', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/teams/event/10')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 1,
              team_number: 42,
              team_name: 'Alpha',
              display_name: 'Alpha',
            },
          ]),
        );
      }
      if (String(url).includes('/queue/event/10')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 9,
              seeding_team_number: 42,
              seeding_team_name: 'Alpha',
              seeding_round: 1,
              seeding_team_id: 1,
            },
          ]),
        );
      }
      return Promise.resolve(jsonErrorResponse(404));
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = clientWithUser();
    renderWithQuery(
      <ScoresheetForm template={seedingTemplate} sessionGeneration="gen-1" />,
      { queryClient: client },
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((call) =>
          String(call[0]).includes('/teams/event/10'),
        ),
      ).toHaveLength(1),
    );
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((call) =>
          String(call[0]).includes('/queue/event/10'),
        ).length,
      ).toBeGreaterThan(0),
    );
    const queueSelect = screen
      .getByText('Select from Queue')
      .parentElement!.querySelector('select')!;
    await waitFor(() =>
      expect(queueSelect.querySelector('option[value="9"]')).toBeTruthy(),
    );
    fireEvent.change(queueSelect, { target: { value: '9' } });
    const autoInput = screen
      .getByText('Autonomous')
      .parentElement!.querySelector('input')!;
    fireEvent.change(autoInput, { target: { value: '12' } });
    await act(async () => {
      await client.refetchQueries({
        queryKey: judgeTeamsQueryOptions('gen-1', 10).queryKey,
      });
    });
    expect((autoInput as HTMLInputElement).value).toBe('12');
    expect((queueSelect as HTMLSelectElement).value).toBe('9');
  });

  it('retains the draft after a failed submit and blocks a second in-flight submit', async () => {
    const submit = deferred<Response>();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes('/api/scores/submit')) return submit.promise;
      if (String(url).includes('/queue/event/10')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 9,
              seeding_team_number: 42,
              seeding_team_name: 'Alpha',
              seeding_round: 1,
              seeding_team_id: 1,
            },
          ]),
        );
      }
      if (String(url).includes('/teams/event/10')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 1,
              team_number: 42,
              team_name: 'Alpha',
              display_name: 'Alpha',
            },
          ]),
        );
      }
      return Promise.resolve(jsonErrorResponse(404));
    });
    vi.stubGlobal('fetch', fetchMock);
    renderWithQuery(
      <ScoresheetForm template={seedingTemplate} sessionGeneration="gen-1" />,
    );
    const queueSelect = await waitFor(
      () =>
        screen
          .getByText('Select from Queue')
          .parentElement!.querySelector('select')!,
    );
    await waitFor(() =>
      expect(queueSelect.querySelector('option[value="9"]')).toBeTruthy(),
    );
    fireEvent.change(queueSelect, { target: { value: '9' } });
    const autoInput = screen
      .getByText('Autonomous')
      .parentElement!.querySelector('input')!;
    fireEvent.change(autoInput, { target: { value: '15' } });
    fireEvent.change(screen.getByLabelText('Team Initials'), {
      target: { value: 'AB' },
    });
    const submitButton = screen.getByRole('button', {
      name: 'Submit Score',
    }) as HTMLButtonElement;
    fireEvent.click(submitButton);
    await waitFor(() => expect(submitButton.disabled).toBe(true));
    fireEvent.click(submitButton);
    expect(
      fetchMock.mock.calls.filter((call) =>
        String(call[0]).includes('/api/scores/submit'),
      ),
    ).toHaveLength(1);
    submit.resolve(jsonErrorResponse(500, 'write failed'));
    await screen.findByText(/Failed to submit score/);
    expect((autoInput as HTMLInputElement).value).toBe('15');
    expect((queueSelect as HTMLSelectElement).value).toBe('9');
  });
});
