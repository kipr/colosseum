// @vitest-environment jsdom
import { act, screen, waitFor } from '@testing-library/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '../../src/client/contexts/AuthContext';
import {
  EventProvider,
  useEvent,
} from '../../src/client/contexts/EventContext';
import { ApiError } from '../../src/client/api/http';
import {
  publicEventsQueryOptions,
  adminEventsQueryOptions,
} from '../../src/client/queries/events';
import {
  adminEventsKey,
  authUserKey,
  publicEventsKey,
} from '../../src/client/queries/keys';
import type { SessionUser } from '../../src/client/api/types';
import type { Event } from '../../src/client/utils/eventStatus';
import {
  createTestQueryClient,
  jsonErrorResponse,
  jsonResponse,
  registerQueryTestCleanup,
  renderWithQuery,
} from './helpers/queryTestUtils';
import {
  eventFive,
  eventNine,
  eventSeven,
  userA,
  userB,
} from './helpers/sessionFixtures';

registerQueryTestCleanup();

afterEach(() => {
  localStorage.clear();
});

const STORAGE_KEY = 'colosseum_selected_event_id';

function LocationPath() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function EventProbe() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { selectedEvent, events, loading, error, selectEventById } = useEvent();
  return (
    <div>
      <div data-testid="loading">{String(loading)}</div>
      <div data-testid="error">{error ?? ''}</div>
      <div data-testid="selected">
        {selectedEvent ? `${selectedEvent.id}:${selectedEvent.name}` : 'none'}
      </div>
      <div data-testid="events">
        {events.map((event) => event.id).join(',')}
      </div>
      <input aria-label="draft" defaultValue="keep-me" />
      <button
        type="button"
        onClick={() => {
          if (user) {
            void queryClient.invalidateQueries({
              queryKey: adminEventsKey(user.id),
            });
          }
        }}
      >
        Refresh
      </button>
      <button type="button" onClick={() => selectEventById(null)}>
        Clear selection
      </button>
      <button type="button" onClick={() => selectEventById(eventSeven.id)}>
        Select seven
      </button>
    </div>
  );
}

function ChildRequests({ seen }: { seen: Array<number | null> }) {
  const { selectedEvent, loading } = useEvent();
  if (!loading) {
    seen.push(selectedEvent?.id ?? null);
  }
  return <EventProbe />;
}

function renderProviders(
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
  options: {
    initialEntries?: string[];
    queryClient?: ReturnType<typeof createTestQueryClient>;
    children?: ReactNode;
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
        <Route
          path="/admin/events/:eventId/brackets/:bracketId"
          element={
            <EventProvider>{options.children ?? <EventProbe />}</EventProvider>
          }
        />
        <Route
          path="/admin/events/:eventId"
          element={
            <EventProvider>{options.children ?? <EventProbe />}</EventProvider>
          }
        />
        <Route
          path="/admin/events"
          element={
            <EventProvider>{options.children ?? <EventProbe />}</EventProvider>
          }
        />
      </Routes>
      <LocationPath />
    </AuthProvider>,
    {
      queryClient,
      router: {
        initialEntries: options.initialEntries ?? ['/admin/events'],
      },
    },
  );
  return { ...view, fetchMock, queryClient };
}

function stubSession(
  user: SessionUser | null,
  events: Event[] | (() => Promise<Response>),
) {
  return async (url: string) => {
    if (url === '/auth/user') {
      return user ? jsonResponse(user) : jsonErrorResponse(401);
    }
    if (url === '/events') {
      return typeof events === 'function' ? events() : jsonResponse(events);
    }
    if (url === '/events/public') {
      return jsonResponse([]);
    }
    return jsonErrorResponse(404, url);
  };
}

describe('EventProvider', () => {
  it('does not request events before auth resolves', async () => {
    let releaseAuth!: (value: Response) => void;
    const { fetchMock } = renderProviders(async (url) => {
      if (url === '/auth/user') {
        return new Promise<Response>((resolve) => {
          releaseAuth = resolve;
        });
      }
      if (url === '/events') return jsonResponse([eventFive]);
      return jsonErrorResponse(404);
    });

    expect(screen.getByTestId('loading').textContent).toBe('true');
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]) === '/events'),
    ).toBe(false);

    releaseAuth(jsonResponse(userA));
    await waitFor(() =>
      expect(screen.getByTestId('selected').textContent).toBe('5:Stored Cup'),
    );
    expect(
      fetchMock.mock.calls.some((call) => String(call[0]) === '/events'),
    ).toBe(true);
  });

  it('loads events for staff without isAdmin', async () => {
    renderProviders(stubSession(userB, [eventFive, eventSeven]));
    await waitFor(() =>
      expect(screen.getByTestId('events').textContent).toBe('5,7'),
    );
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  it('returns an empty list when signed out', async () => {
    renderProviders(stubSession(null, [eventFive]));
    await waitFor(() =>
      expect(screen.getByTestId('loading').textContent).toBe('false'),
    );
    expect(screen.getByTestId('events').textContent).toBe('');
    expect(screen.getByTestId('selected').textContent).toBe('none');
    expect(
      vi
        .mocked(globalThis.fetch)
        .mock.calls.some((call) => String(call[0]) === '/events'),
    ).toBe(false);
  });

  it('lets a deep-link URL beat localStorage before children observe a selection', async () => {
    localStorage.setItem(STORAGE_KEY, String(eventFive.id));
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(authUserKey, userA);
    queryClient.setQueryData(adminEventsKey(userA.id), [eventFive, eventSeven]);
    const seen: Array<number | null> = [];

    renderProviders(stubSession(userA, [eventFive, eventSeven]), {
      queryClient,
      initialEntries: [`/admin/events/${eventSeven.id}?view=teams`],
      children: <ChildRequests seen={seen} />,
    });

    await waitFor(() =>
      expect(screen.getByTestId('selected').textContent).toBe(
        '7:Deep Link Open',
      ),
    );
    expect(seen.some((id) => id === eventFive.id)).toBe(false);
    expect(seen).toContain(eventSeven.id);
  });

  it('restores a valid stored selection when the route has no event id', async () => {
    localStorage.setItem(STORAGE_KEY, String(eventSeven.id));
    renderProviders(stubSession(userA, [eventFive, eventSeven, eventNine]));
    await waitFor(() =>
      expect(screen.getByTestId('selected').textContent).toBe(
        '7:Deep Link Open',
      ),
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBe(String(eventSeven.id));
  });

  it('falls back to the first active/setup event when nothing is stored', async () => {
    renderProviders(stubSession(userA, [eventNine, eventFive, eventSeven]));
    await waitFor(() =>
      expect(screen.getByTestId('selected').textContent).toBe('5:Stored Cup'),
    );
  });

  it('redirects a missing route id once a successful list establishes absence', async () => {
    renderProviders(stubSession(userA, [eventFive, eventSeven]), {
      initialEntries: ['/admin/events/404?view=teams'],
    });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/admin/events?view=teams',
      ),
    );
  });

  it('redirects a malformed route id after a successful list', async () => {
    renderProviders(stubSession(userA, [eventFive]), {
      initialEntries: ['/admin/events/not-an-id'],
    });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/events'),
    );
  });

  it('redirects an empty successful list away from a stale route id', async () => {
    renderProviders(stubSession(userA, []), {
      initialEntries: ['/admin/events/5'],
    });
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/events'),
    );
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('does not treat a failed refresh as proof a route id was deleted', async () => {
    let failEvents = false;
    renderProviders(
      async (url) => {
        if (url === '/auth/user') return jsonResponse(userA);
        if (url === '/events') {
          if (failEvents)
            return jsonErrorResponse(500, 'Failed to fetch events');
          return jsonResponse([eventFive, eventSeven]);
        }
        return jsonErrorResponse(404);
      },
      { initialEntries: [`/admin/events/${eventSeven.id}`] },
    );

    await waitFor(() =>
      expect(screen.getByTestId('selected').textContent).toBe(
        '7:Deep Link Open',
      ),
    );
    failEvents = true;
    await act(async () => {
      screen.getByRole('button', { name: 'Refresh' }).click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).not.toBe(''),
    );
    expect(screen.getByTestId('selected').textContent).toBe('7:Deep Link Open');
    expect(screen.getByTestId('location').textContent).toContain(
      `/admin/events/${eventSeven.id}`,
    );
  });

  it('keeps the list visible during background refresh and preserves drafts', async () => {
    let pending: ((value: Response) => void) | undefined;
    let calls = 0;
    renderProviders(async (url) => {
      if (url === '/auth/user') return jsonResponse(userA);
      if (url === '/events') {
        calls += 1;
        if (calls === 1) return jsonResponse([eventFive, eventSeven]);
        return new Promise<Response>((resolve) => {
          pending = resolve;
        });
      }
      return jsonErrorResponse(404);
    });

    await waitFor(() =>
      expect(screen.getByTestId('selected').textContent).toContain(
        'Stored Cup',
      ),
    );
    const draft = screen.getByLabelText('draft') as HTMLInputElement;
    draft.value = 'typed-notes';
    await act(async () => {
      screen.getByRole('button', { name: 'Refresh' }).click();
    });
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('events').textContent).toBe('5,7');
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe(
      'typed-notes',
    );
    pending?.(
      jsonResponse([{ ...eventFive, name: 'Stored Cup Updated' }, eventSeven]),
    );
    await waitFor(() =>
      expect(screen.getByTestId('selected').textContent).toBe(
        '5:Stored Cup Updated',
      ),
    );
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect((screen.getByLabelText('draft') as HTMLInputElement).value).toBe(
      'typed-notes',
    );
  });

  it('invalidating the event query refetches even when the cache is fresh and keeps previous data on failure', async () => {
    let calls = 0;
    let fail = false;
    renderProviders(async (url) => {
      if (url === '/auth/user') return jsonResponse(userA);
      if (url === '/events') {
        calls += 1;
        if (fail) return jsonErrorResponse(500, 'Failed to fetch events');
        return jsonResponse([eventFive]);
      }
      return jsonErrorResponse(404);
    });

    await waitFor(() =>
      expect(screen.getByTestId('events').textContent).toBe('5'),
    );
    const initialCalls = calls;
    await act(async () => {
      screen.getByRole('button', { name: 'Refresh' }).click();
    });
    await waitFor(() => expect(calls).toBeGreaterThan(initialCalls));

    fail = true;
    await act(async () => {
      screen.getByRole('button', { name: 'Refresh' }).click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).not.toBe(''),
    );
    expect(screen.getByTestId('events').textContent).toBe('5');
  });

  it('keeps an unresolved created id without inventing an event object', async () => {
    let failEvents = false;
    renderProviders(async (url) => {
      if (url === '/auth/user') return jsonResponse(userA);
      if (url === '/events') {
        if (failEvents) return jsonErrorResponse(500, 'Failed to fetch events');
        return jsonResponse([eventFive]);
      }
      return jsonErrorResponse(404);
    });
    await waitFor(() =>
      expect(screen.getByTestId('selected').textContent).toBe('5:Stored Cup'),
    );
    failEvents = true;
    await act(async () => {
      screen.getByRole('button', { name: 'Refresh' }).click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).not.toBe(''),
    );
    await act(async () => {
      screen.getByRole('button', { name: 'Select seven' }).click();
    });
    expect(screen.getByTestId('selected').textContent).toBe('none');
    expect(screen.getByTestId('events').textContent).toBe('5');
    expect(localStorage.getItem(STORAGE_KEY)).toBe(String(eventSeven.id));
  });

  it('falls back after a successful refresh removes the selected event', async () => {
    let events: Event[] = [eventFive, eventSeven, eventNine];
    renderProviders(
      async (url) => {
        if (url === '/auth/user') return jsonResponse(userA);
        if (url === '/events') return jsonResponse(events);
        return jsonErrorResponse(404);
      },
      { initialEntries: [`/admin/events/${eventSeven.id}`] },
    );

    await waitFor(() =>
      expect(screen.getByTestId('selected').textContent).toBe(
        '7:Deep Link Open',
      ),
    );
    events = [eventNine, eventFive];
    await act(async () => {
      screen.getByRole('button', { name: 'Refresh' }).click();
    });
    await waitFor(() =>
      expect(screen.getByTestId('selected').textContent).toBe('5:Stored Cup'),
    );
  });

  it('clears storage for an explicit null selection', async () => {
    renderProviders(stubSession(userA, [eventFive, eventSeven]));
    await waitFor(() =>
      expect(screen.getByTestId('selected').textContent).not.toBe('none'),
    );
    await act(async () => {
      screen.getByRole('button', { name: 'Clear selection' }).click();
    });
    expect(screen.getByTestId('selected').textContent).toBe('none');
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('does not let a late user-A refresh populate user-B state', async () => {
    let releaseA!: (value: Response) => void;
    let currentUser: SessionUser = userA;
    let eventCalls = 0;

    const { queryClient } = renderProviders(async (url) => {
      if (url === '/auth/user') return jsonResponse(currentUser);
      if (url === '/events') {
        eventCalls += 1;
        if (eventCalls === 1) {
          return new Promise<Response>((resolve) => {
            releaseA = resolve;
          });
        }
        return jsonResponse([eventSeven]);
      }
      return jsonErrorResponse(404);
    });

    await waitFor(() => expect(eventCalls).toBe(1));
    currentUser = userB;
    await act(async () => {
      await queryClient.setQueryData(authUserKey, userB);
      await queryClient.invalidateQueries({ queryKey: authUserKey });
    });
    await waitFor(() =>
      expect(screen.getByTestId('events').textContent).toBe('7'),
    );
    releaseA(jsonResponse([eventFive]));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId('events').textContent).toBe('7');
    expect(queryClient.getQueryData(adminEventsKey(userA.id))).toBeUndefined();
  });

  it('treats event 401 as loss of that scope and revalidates the session', async () => {
    let eventStatus: 200 | 401 = 200;
    let authCalls = 0;
    renderProviders(async (url) => {
      if (url === '/auth/user') {
        authCalls += 1;
        return jsonResponse(userA);
      }
      if (url === '/events') {
        return eventStatus === 200
          ? jsonResponse([eventFive])
          : jsonErrorResponse(401, 'Not authenticated');
      }
      return jsonErrorResponse(404);
    });

    await waitFor(() =>
      expect(screen.getByTestId('events').textContent).toBe('5'),
    );
    const authBefore = authCalls;
    eventStatus = 401;
    await act(async () => {
      screen.getByRole('button', { name: 'Refresh' }).click();
    });
    await waitFor(() => expect(authCalls).toBeGreaterThan(authBefore));
  });

  it('does not treat event 403 as session expiry', async () => {
    let authCalls = 0;
    renderProviders(async (url) => {
      if (url === '/auth/user') {
        authCalls += 1;
        return jsonResponse(userA);
      }
      if (url === '/events') return jsonErrorResponse(403, 'Forbidden');
      return jsonErrorResponse(404);
    });

    await waitFor(() =>
      expect(screen.getByTestId('error').textContent).toMatch(
        /Forbidden|failed/i,
      ),
    );
    expect(screen.getByTestId('loading').textContent).toBe('false');
    await act(async () => {
      await Promise.resolve();
    });
    expect(authCalls).toBe(1);
  });

  it('keeps public discovery cache independent from admin cleanup', async () => {
    const queryClient = createTestQueryClient();
    function PublicProbe() {
      const query = useQuery(publicEventsQueryOptions());
      return <div data-testid="public">{query.data?.length ?? 'none'}</div>;
    }
    function AuthStatus() {
      const { user } = useAuth();
      return <div data-testid="auth-user">{user?.id ?? 'none'}</div>;
    }

    let status: 200 | 401 = 200;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/auth/user') {
        return status === 200 ? jsonResponse(userA) : jsonErrorResponse(401);
      }
      if (url === '/events') return jsonResponse([eventFive]);
      if (url === '/events/public')
        return jsonResponse([{ id: 21, name: 'Public' }]);
      return jsonErrorResponse(404);
    });
    vi.stubGlobal('fetch', fetchMock);

    renderWithQuery(
      <AuthProvider>
        <PublicProbe />
        <AuthStatus />
        <Routes>
          <Route
            path="/admin/events"
            element={
              <EventProvider>
                <EventProbe />
              </EventProvider>
            }
          />
        </Routes>
      </AuthProvider>,
      { queryClient, router: { initialEntries: ['/admin/events'] } },
    );

    await waitFor(() =>
      expect(screen.getByTestId('auth-user').textContent).toBe('1'),
    );
    await waitFor(() =>
      expect(screen.getByTestId('public').textContent).toBe('1'),
    );
    status = 401;
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: authUserKey });
    });
    await waitFor(() =>
      expect(screen.getByTestId('auth-user').textContent).toBe('none'),
    );
    expect(queryClient.getQueryData(publicEventsKey)).toEqual([
      { id: 21, name: 'Public' },
    ]);
  });
});

describe('adminEventsQueryOptions', () => {
  it('uses a cache entry separate from public events', async () => {
    const queryClient = createTestQueryClient();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/events/public') return jsonResponse([{ id: 21 }]);
      if (url === '/events') return jsonResponse([eventFive]);
      return jsonErrorResponse(404);
    });
    vi.stubGlobal('fetch', fetchMock);

    await queryClient.fetchQuery(publicEventsQueryOptions());
    await queryClient.fetchQuery(adminEventsQueryOptions(userA.id));

    expect(queryClient.getQueryData(publicEventsKey)).toEqual([{ id: 21 }]);
    expect(queryClient.getQueryData(adminEventsKey(userA.id))).toEqual([
      eventFive,
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('ApiError 401 helper', () => {
  it('can be distinguished from permission failures', () => {
    expect(new ApiError('nope', { status: 401 }).status).toBe(401);
    expect(new ApiError('nope', { status: 403 }).status).toBe(403);
  });
});
