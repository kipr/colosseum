// @vitest-environment jsdom
import { act, renderHook, screen, waitFor } from '@testing-library/react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import {
  createTestQueryClient,
  createQueryWrapper,
  jsonErrorResponse,
  jsonResponse,
  registerQueryTestCleanup,
  renderWithQuery,
} from './helpers/queryTestUtils';
import {
  auditKey,
  authUserKey,
  bracketsKey,
  documentationKey,
  overallKey,
  seedingKey,
} from '../../src/client/queries/keys';
import {
  teamsQueryOptions,
  useTeamMutations,
} from '../../src/client/queries/teams';
import {
  publicSeedingScoresQueryOptions,
  seedingRankingsQueryOptions,
  seedingScoresQueryOptions,
} from '../../src/client/queries/seeding';
import {
  bracketsQueryOptions,
  publicBracketsQueryOptions,
} from '../../src/client/queries/brackets';
import {
  automaticAwardPreviewQueryOptions,
  automaticAwardSettingsQueryOptions,
  publicAwardsQueryOptions,
} from '../../src/client/queries/awards';
import { useDocumentationMutations } from '../../src/client/queries/documentation';
import { useDoubleSeedingMutations } from '../../src/client/queries/doubleSeeding';
import { auditHistoryQueryOptions } from '../../src/client/queries/audit';
import { publicOverallQueryOptions } from '../../src/client/queries/events';
import { removeRestrictedPublicResults } from '../../src/client/queries/invalidation';
import { DEFAULT_AUTOMATIC_AWARD_SETTINGS } from '../../src/shared/automaticAwards';
import Spectator from '../../src/client/pages/Spectator';

const auth = vi.hoisted(() => ({
  user: { id: 1, isAdmin: true },
  loading: false,
}));
vi.mock('../../src/client/contexts/AuthContext', () => ({
  useAuth: () => auth,
}));
vi.mock('../../src/client/components/Navbar', () => ({
  default: () => null,
}));
registerQueryTestCleanup();

function clientWithUser() {
  const client = createTestQueryClient();
  client.setQueryData(authUserKey, auth.user);
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

describe('stage four queries and writes', () => {
  it('reuses unfiltered team and ranking caches across consumers', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/teams/event/')) {
        return Promise.resolve(jsonResponse([{ id: 1, team_name: 'A' }]));
      }
      if (String(url).includes('/seeding/rankings/')) {
        return Promise.resolve(jsonResponse([{ team_id: 1, seed_rank: 1 }]));
      }
      return Promise.resolve(jsonErrorResponse(404));
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = clientWithUser();
    renderHook(
      () => {
        useQuery(teamsQueryOptions(1, 10));
        useQuery(teamsQueryOptions(1, 10));
        useQuery(seedingRankingsQueryOptions(1, 10));
        useQuery(seedingRankingsQueryOptions(1, 10));
      },
      { wrapper: createQueryWrapper({ queryClient: client }) },
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const teamCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/teams/event/10'),
    );
    const rankingCalls = fetchMock.mock.calls.filter((call) =>
      String(call[0]).includes('/seeding/rankings/event/10'),
    );
    expect(teamCalls).toHaveLength(1);
    expect(rankingCalls).toHaveLength(1);
  });

  it('shares one bracket-list cache between management and template editors', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ id: 3, name: 'Main' }]));
    vi.stubGlobal('fetch', fetchMock);
    const client = clientWithUser();
    renderHook(
      () => {
        useQuery(bracketsQueryOptions(1, 10));
        useQuery(bracketsQueryOptions(1, 10));
      },
      { wrapper: createQueryWrapper({ queryClient: client }) },
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(bracketsQueryOptions(1, 10).queryKey).toEqual(bracketsKey(1, 10));
  });

  it('keeps public and authenticated cache entries separate', () => {
    expect(publicSeedingScoresQueryOptions(10).queryKey).not.toEqual(
      seedingScoresQueryOptions(1, 10).queryKey,
    );
    expect(publicBracketsQueryOptions(10).queryKey).not.toEqual(
      bracketsQueryOptions(1, 10).queryKey,
    );
    expect(publicSeedingScoresQueryOptions(10).queryKey[0]).toBe('public');
    expect(seedingScoresQueryOptions(1, 10).queryKey[0]).toBe('admin');
  });

  it('keys automatic previews by complete settings and not the saved-settings GET', () => {
    const settingsA = { ...DEFAULT_AUTOMATIC_AWARD_SETTINGS, de_top_n: 1 };
    const settingsB = { ...DEFAULT_AUTOMATIC_AWARD_SETTINGS, de_top_n: 2 };
    expect(
      automaticAwardPreviewQueryOptions(1, 10, settingsA).queryKey,
    ).not.toEqual(automaticAwardPreviewQueryOptions(1, 10, settingsB).queryKey);
    expect(automaticAwardSettingsQueryOptions(1, 10).queryKey).not.toEqual(
      automaticAwardPreviewQueryOptions(1, 10, settingsA).queryKey,
    );
  });

  it('does not display another event after an identity-scoped switch', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (String(url).includes('/teams/event/10')) {
        return Promise.resolve(jsonResponse([{ id: 10, team_name: 'Ten' }]));
      }
      if (String(url).includes('/teams/event/20')) {
        return Promise.resolve(jsonResponse([{ id: 20, team_name: 'Twenty' }]));
      }
      return Promise.resolve(jsonErrorResponse(404));
    });
    vi.stubGlobal('fetch', fetchMock);
    const client = clientWithUser();
    const { result, rerender } = renderHook(
      ({ eventId }: { eventId: number }) =>
        useQuery(teamsQueryOptions(1, eventId)),
      {
        wrapper: createQueryWrapper({ queryClient: client }),
        initialProps: { eventId: 10 },
      },
    );
    await waitFor(() => expect(result.current.data?.[0].team_name).toBe('Ten'));
    rerender({ eventId: 20 });
    await waitFor(() =>
      expect(result.current.data?.[0].team_name).toBe('Twenty'),
    );
    expect(result.current.data?.some((row) => row.team_name === 'Ten')).toBe(
      false,
    );
  });

  it('invalidates the originating event after a delayed double-seeding write', async () => {
    const response = deferred<Response>();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => response.promise),
    );
    const client = clientWithUser();
    const origin = [...seedingKey(1, 10).slice(0, 4)];
    client.setQueryData([...origin, 'double-seeding', 'matches'], []);
    client.setQueryData(overallKey(1, 10), []);
    client.setQueryData(awardsKey(1, 10), []);
    const hook = renderHook(() => useDoubleSeedingMutations(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    let result!: Promise<unknown>;
    act(() => {
      result = hook.result.current.generate.mutateAsync({
        userId: 1,
        eventId: 10,
        rounds: 2,
      });
    });
    client.setQueryData(overallKey(1, 20), [{ team_id: 20 }]);
    response.resolve(jsonResponse({ matchesCreated: 1 }));
    await act(async () => {
      await result;
    });
    expect(
      client.getQueryState([...origin, 'double-seeding', 'matches'])
        ?.isInvalidated,
    ).toBe(true);
    expect(client.getQueryState(overallKey(1, 10))?.isInvalidated).toBe(true);
    expect(client.getQueryState(overallKey(1, 20))?.isInvalidated).not.toBe(
      true,
    );
  });

  it('refreshes dependents after a successful team write even when a later refresh fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, options) =>
        Promise.resolve(
          options?.method === 'POST'
            ? jsonResponse({ id: 1 })
            : jsonErrorResponse(500),
        ),
      ),
    );
    const client = clientWithUser();
    const teamKey = teamsQueryOptions(1, 10).queryKey;
    client.setQueryData(teamKey, [{ id: 1, team_name: 'Old' }]);
    client.setQueryData(overallKey(1, 10), []);
    client.setQueryData(auditKey(1, 10), []);
    const hook = renderHook(
      () => ({
        query: useQuery(teamsQueryOptions(1, 10)),
        ...useTeamMutations(),
      }),
      { wrapper: createQueryWrapper({ queryClient: client }) },
    );
    await act(async () => {
      await hook.result.current.save.mutateAsync({
        userId: 1,
        eventId: 10,
        data: { team_number: 1, team_name: 'Changed' },
      });
    });
    expect(hook.result.current.save.isSuccess).toBe(true);
    expect(client.getQueryState(overallKey(1, 10))?.isInvalidated).toBe(true);
    expect(client.getQueryState(auditKey(1, 10))?.isInvalidated).toBe(true);
  });

  it('refreshes documentation after a partial bulk import with some successful writes', async () => {
    let posts = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((_url, options) => {
        if (options?.method === 'POST') {
          posts += 1;
          return Promise.resolve(
            posts === 1
              ? jsonResponse({ id: 1 })
              : jsonErrorResponse(500, 'row failed'),
          );
        }
        return Promise.resolve(jsonResponse([]));
      }),
    );
    const client = clientWithUser();
    const scoresKey = [...documentationKey(1, 10), 'scores'];
    client.setQueryData(scoresKey, [{ id: 1 }]);
    const hook = renderHook(() => useDocumentationMutations(), {
      wrapper: createQueryWrapper({ queryClient: client }),
    });
    let results: { ok: boolean }[] = [];
    await act(async () => {
      results = await hook.result.current.bulkImport.mutateAsync({
        userId: 1,
        eventId: 10,
        rows: [
          { teamId: 1, sub_scores: [{ category_id: 1, score: 5 }], index: 0 },
          { teamId: 2, sub_scores: [{ category_id: 1, score: 6 }], index: 1 },
        ],
      });
    });
    expect(results.map((row) => row.ok)).toEqual([true, false]);
    expect(hook.result.current.bulkImport.isSuccess).toBe(true);
    expect(client.getQueryState(scoresKey)?.isInvalidated).toBe(true);
  });

  it('cancels an in-flight audit page when filters change', async () => {
    const first = deferred<Response>();
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      const parsed = new URL(String(url), 'http://localhost');
      if (parsed.searchParams.get('action') === 'create') {
        return Promise.resolve(jsonResponse([{ id: 2, action: 'create' }]));
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
      ({ action }: { action: string }) =>
        useInfiniteQuery(
          auditHistoryQueryOptions(1, 10, { action, entityType: '' }),
        ),
      {
        wrapper: createQueryWrapper({ queryClient: client }),
        initialProps: { action: '' },
      },
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    rerender({ action: 'create' });
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some((call) =>
          String(call[0]).includes('action=create'),
        ),
      ).toBe(true),
    );
    first.resolve(jsonResponse([{ id: 1, action: 'update' }]));
    await waitFor(() =>
      expect(
        client.getQueryData(
          auditHistoryQueryOptions(1, 10, { action: 'create', entityType: '' })
            .queryKey,
        ),
      ).toBeTruthy(),
    );
    const filtered = client.getQueryData(
      auditHistoryQueryOptions(1, 10, { action: 'create', entityType: '' })
        .queryKey,
    ) as { pages: { action: string }[][] } | undefined;
    expect(filtered?.pages.flat().every((row) => row.action === 'create')).toBe(
      true,
    );
  });

  it('removes cached spectator finals when they become unavailable', async () => {
    const event = {
      id: 5,
      name: 'Released',
      status: 'active',
      event_date: null,
      location: null,
      seeding_rounds: 3,
      double_seeding_rounds: 0,
      final_scores_available: true,
    };
    let released = true;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const path = String(url);
        if (path === '/events/public') {
          return Promise.resolve(
            jsonResponse([{ ...event, final_scores_available: released }]),
          );
        }
        if (path.includes('/teams/event/')) {
          return Promise.resolve(jsonResponse([]));
        }
        if (path.includes('/seeding/')) {
          return Promise.resolve(jsonResponse([]));
        }
        if (path.includes('/brackets/event/')) {
          return Promise.resolve(jsonResponse([]));
        }
        if (path.includes('/overall/public')) {
          return Promise.resolve(
            jsonResponse([{ team_id: 1, team_name: 'Hidden Row', total: 9 }]),
          );
        }
        return Promise.resolve(jsonErrorResponse(404));
      }),
    );
    const client = clientWithUser();
    renderWithQuery(
      <Routes>
        <Route path="/spectator/events/:eventId" element={<Spectator />} />
      </Routes>,
      {
        queryClient: client,
        router: { initialEntries: ['/spectator/events/5?view=overall'] },
      },
    );
    await waitFor(() =>
      expect(screen.getByText('Hidden Row')).toBeInTheDocument(),
    );
    expect(
      client.getQueryData(publicOverallQueryOptions(5).queryKey),
    ).toBeTruthy();
    released = false;
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['public', 'events'] });
    });
    await waitFor(() =>
      expect(screen.queryByText('Hidden Row')).not.toBeInTheDocument(),
    );
    expect(
      client.getQueryData(publicOverallQueryOptions(5).queryKey),
    ).toBeUndefined();
  });

  it('can drop restricted public results without clearing seeding caches', async () => {
    const client = createTestQueryClient();
    client.setQueryData(publicOverallQueryOptions(5).queryKey, [{ total: 1 }]);
    client.setQueryData(publicAwardsQueryOptions(5).queryKey, { manual: [] });
    client.setQueryData(publicSeedingScoresQueryOptions(5).queryKey, [
      { id: 1 },
    ]);
    await removeRestrictedPublicResults(client, 5);
    expect(
      client.getQueryData(publicOverallQueryOptions(5).queryKey),
    ).toBeUndefined();
    expect(
      client.getQueryData(publicAwardsQueryOptions(5).queryKey),
    ).toBeUndefined();
    expect(
      client.getQueryData(publicSeedingScoresQueryOptions(5).queryKey),
    ).toEqual([{ id: 1 }]);
  });
});
