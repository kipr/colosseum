// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../../src/client/contexts/AuthContext';
import Home from '../../src/client/pages/Home';
import { authUserQueryOptions } from '../../src/client/queries/auth';
import { ADMIN_ONLY_QUERY_META } from '../../src/client/queries/invalidation';
import {
  authUserKey,
  judgeScopeKey,
  publicEventsKey,
  adminEventsKey,
} from '../../src/client/queries/keys';
import {
  createTestQueryClient,
  jsonErrorResponse,
  jsonResponse,
  registerQueryTestCleanup,
  renderWithQuery,
} from './helpers/queryTestUtils';
import { eventFive, userA, userB } from './helpers/sessionFixtures';

registerQueryTestCleanup();

vi.mock('../../src/client/components/Navbar', () => ({
  default: function NavbarStub() {
    return <nav data-testid="navbar-stub">Navbar</nav>;
  },
}));

function AuthProbe() {
  const { user, loading, serverAvailable, checkAuth, logout } = useAuth();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="available">{String(serverAvailable)}</div>
      <div data-testid="user">{user ? `${user.id}:${user.email}` : 'none'}</div>
      <button type="button" onClick={() => void checkAuth()}>
        Recheck
      </button>
      <button type="button" onClick={() => logout()}>
        Logout
      </button>
    </div>
  );
}

function renderAuth(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  options: {
    initialEntries?: string[];
    queryClient?: ReturnType<typeof createTestQueryClient>;
  } = {},
) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    fetchImpl(String(input), init),
  );
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = options.queryClient ?? createTestQueryClient();
  const view = renderWithQuery(
    <AuthProvider>
      <Routes>
        <Route path="/" element={<AuthProbe />} />
        <Route path="/admin/events" element={<AuthProbe />} />
      </Routes>
    </AuthProvider>,
    {
      queryClient,
      router: { initialEntries: options.initialEntries ?? ['/'] },
    },
  );
  return { ...view, fetchMock, queryClient };
}

describe('AuthProvider', () => {
  it('exposes the user after a successful startup lookup', async () => {
    renderAuth(async (url) => {
      if (url === '/auth/user') return jsonResponse(userA);
      return jsonErrorResponse(404);
    });

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('1:a@kipr.org'),
    );
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('available').textContent).toBe('true');
  });

  it('treats 401 as confirmed sign-out', async () => {
    renderAuth(async (url) => {
      if (url === '/auth/user')
        return jsonErrorResponse(401, 'Not authenticated');
      return jsonErrorResponse(404);
    });

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    );
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(screen.getByTestId('available').textContent).toBe('true');
  });

  it('shows an outage during retries without treating it as logout', async () => {
    const fetchMock = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    );
    vi.stubGlobal('fetch', fetchMock);
    const queryClient = createTestQueryClient();
    renderWithQuery(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
      { queryClient, router: false },
    );

    await waitFor(() =>
      expect(screen.getByTestId('available').textContent).toBe('false'),
    );
    expect(screen.getByTestId('loading').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(fetchMock.mock.calls.length).toBeLessThan(11);
  });

  it('stops loading after a terminal lookup failure and keeps retry available', async () => {
    let succeed = false;
    renderAuth(async (url) => {
      if (url === '/auth/user') {
        return succeed
          ? jsonResponse(userA)
          : jsonErrorResponse(400, 'bad session');
      }
      return jsonErrorResponse(404);
    });

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    );
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(screen.getByTestId('available').textContent).toBe('false');

    succeed = true;
    await act(async () => {
      screen.getByRole('button', { name: 'Recheck' }).click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('1:a@kipr.org'),
    );
    expect(screen.getByTestId('available').textContent).toBe('true');
  });

  it('does not infer logout from a terminal lookup failure', async () => {
    renderAuth(async (url) => {
      if (url === '/auth/user') return jsonErrorResponse(400, 'bad session');
      return jsonErrorResponse(404);
    });

    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    );
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(screen.getByTestId('available').textContent).toBe('false');
  });

  it('retains the confirmed user when a background lookup fails', async () => {
    let shouldFail = false;
    const { queryClient } = renderAuth(async (url) => {
      if (url === '/auth/user') {
        if (shouldFail) return jsonErrorResponse(400, 'bad session');
        return jsonResponse(userA);
      }
      return jsonErrorResponse(404);
    });

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('1:a@kipr.org'),
    );
    shouldFail = true;
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: authUserKey });
    });
    await waitFor(() =>
      expect(screen.getByTestId('available').textContent).toBe('false'),
    );
    expect(screen.getByTestId('user').textContent).toBe('1:a@kipr.org');
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('attempts lookup immediately even when the browser reports offline', async () => {
    onlineManager.setOnline(false);
    const { fetchMock } = renderAuth(async (url) => {
      if (url === '/auth/user') return jsonResponse(userA);
      return jsonErrorResponse(404);
    });

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('1:a@kipr.org'),
    );
    expect(fetchMock).toHaveBeenCalled();
  });

  it('replaces identity only after old admin data is removed', async () => {
    const seen: string[] = [];
    function TrackingProbe() {
      const { user, loading } = useAuth();
      seen.push(`${loading}:${user?.id ?? 'none'}`);
      return <AuthProbe />;
    }

    let currentUser = userA;
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(adminEventsKey(userA.id), [eventFive]);
    queryClient.setQueryData(publicEventsKey, [{ id: 21 }]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/auth/user') return jsonResponse(currentUser);
      return jsonErrorResponse(404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(
      <AuthProvider>
        <TrackingProbe />
      </AuthProvider>,
      { queryClient, router: false },
    );

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('1:a@kipr.org'),
    );
    currentUser = userB;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: authUserKey });
    });
    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('2:b@kipr.org'),
    );

    expect(queryClient.getQueryData(adminEventsKey(userA.id))).toBeUndefined();
    expect(queryClient.getQueryData(publicEventsKey)).toEqual([{ id: 21 }]);
    expect(
      seen.some(
        (entry) =>
          entry === 'false:1' && seen.indexOf('false:2') > seen.indexOf(entry),
      ),
    ).toBe(true);
    expect(
      seen.filter((entry) => entry === 'false:1' || entry === 'false:2').length,
    ).toBeGreaterThan(1);
  });

  it('clears protected data on confirmed expiry without touching public cache', async () => {
    let status: 200 | 401 = 200;
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(publicEventsKey, [{ id: 21 }]);
    queryClient.setQueryData(adminEventsKey(userA.id), [eventFive]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/auth/user') {
        return status === 200
          ? jsonResponse(userA)
          : jsonErrorResponse(401, 'Not authenticated');
      }
      return jsonErrorResponse(404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
      { queryClient, router: false },
    );

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('1:a@kipr.org'),
    );
    status = 401;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: authUserKey });
    });
    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('none'),
    );
    expect(queryClient.getQueryData(adminEventsKey(userA.id))).toBeUndefined();
    expect(queryClient.getQueryData(publicEventsKey)).toEqual([{ id: 21 }]);
    expect(screen.getByTestId('available').textContent).toBe('true');
  });

  it('evicts admin-only queries on a same-user permission change', async () => {
    let current = { ...userA, isAdmin: true as boolean | undefined };
    const queryClient = createTestQueryClient();
    await queryClient.fetchQuery({
      queryKey: ['admin', userA.id, 'users'],
      queryFn: () => [{ id: 8 }],
      meta: ADMIN_ONLY_QUERY_META,
    });
    queryClient.setQueryData(adminEventsKey(userA.id), [eventFive]);

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/auth/user') return jsonResponse(current);
      return jsonErrorResponse(404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
      { queryClient, router: false },
    );

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('1:a@kipr.org'),
    );
    current = { ...userA, isAdmin: false };
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: authUserKey });
    });
    await waitFor(() =>
      expect(
        queryClient.getQueryData(['admin', userA.id, 'users']),
      ).toBeUndefined(),
    );
    expect(queryClient.getQueryData(adminEventsKey(userA.id))).toEqual([
      eventFive,
    ]);
  });

  it('cancels an in-flight session read on logout so a late response cannot restore the user', async () => {
    let release!: (value: Response) => void;
    let calls = 0;
    const hrefSetter = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...window.location,
        set href(value: string) {
          hrefSetter(value);
        },
        get href() {
          return 'http://localhost/';
        },
      },
    });

    const queryClient = createTestQueryClient();
    queryClient.setQueryData([...judgeScopeKey, 1, 'queue'], [{ id: 1 }]);

    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return Promise.resolve(jsonResponse(userA));
      }
      return new Promise<Response>((resolve, reject) => {
        release = resolve;
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('This operation was aborted', 'AbortError'));
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
      { queryClient, router: false },
    );

    await waitFor(() =>
      expect(screen.getByTestId('user').textContent).toBe('1:a@kipr.org'),
    );
    await act(async () => {
      await queryClient.invalidateQueries({
        queryKey: authUserKey,
        refetchType: 'none',
      });
      void queryClient.prefetchQuery(authUserQueryOptions());
    });
    await waitFor(() => expect(calls).toBeGreaterThanOrEqual(2));

    await act(async () => {
      screen.getByRole('button', { name: 'Logout' }).click();
    });

    await waitFor(() =>
      expect(hrefSetter).toHaveBeenCalledWith('/auth/logout'),
    );
    release(jsonResponse(userA));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('user').textContent).toBe('none');
    expect(
      queryClient.getQueryData([...judgeScopeKey, 1, 'queue']),
    ).toBeUndefined();
  });
});

describe('Home OAuth handoff', () => {
  it('keeps logged_in pending while session lookup is unavailable', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/auth/user') {
        return jsonErrorResponse(400, 'bad session');
      }
      return jsonErrorResponse(404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(
      <AuthProvider>
        <Home />
      </AuthProvider>,
      {
        router: { initialEntries: ['/?logged_in=1'] },
      },
    );

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy(),
    );
    expect(screen.getByRole('alert').textContent).toMatch(
      /Unable to verify your session|Unable to reach the server/,
    );
  });
});
