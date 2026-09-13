// @vitest-environment jsdom
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../src/client/contexts/AuthContext';
import {
  EventProvider,
  useEvent,
} from '../../src/client/contexts/EventContext';
import EventsTab from '../../src/client/components/admin/EventsTab';
import { adminEventsKey, authUserKey } from '../../src/client/queries/keys';
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
  makeEvent,
  userA,
} from './helpers/sessionFixtures';
import type { Event } from '../../src/client/utils/eventStatus';
import type { SessionUser } from '../../src/client/api/types';

registerQueryTestCleanup();

afterEach(() => {
  localStorage.clear();
});

const createdEvent = makeEvent({
  id: 42,
  name: 'New Cup',
  status: 'setup',
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function LocationPath() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

function EventsError() {
  const { error } = useEvent();
  return <div data-testid="events-error">{error ?? ''}</div>;
}

function renderEventsTab(options: {
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;
  initialEntries?: string[];
  queryClient?: ReturnType<typeof createTestQueryClient>;
}) {
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    options.fetchImpl(String(input), init),
  );
  vi.stubGlobal('fetch', fetchMock);
  const queryClient = options.queryClient ?? createTestQueryClient();
  const view = renderWithQuery(
    <AuthProvider>
      <Routes>
        <Route
          path="/admin/events/:eventId"
          element={
            <EventProvider>
              <EventsError />
              <EventsTab />
            </EventProvider>
          }
        />
        <Route
          path="/admin/events"
          element={
            <EventProvider>
              <EventsError />
              <EventsTab />
            </EventProvider>
          }
        />
      </Routes>
      <LocationPath />
    </AuthProvider>,
    {
      queryClient,
      router: {
        initialEntries: options.initialEntries ?? ['/admin/events?view=events'],
      },
    },
  );
  return { ...view, fetchMock, queryClient };
}

function stubAdmin(
  user: SessionUser,
  events: Event[] | (() => Promise<Response>),
  writes?: (url: string, init?: RequestInit) => Promise<Response> | undefined,
) {
  return async (url: string, init?: RequestInit) => {
    const write = writes?.(url, init);
    if (write) return write;
    if (url === '/auth/user') return jsonResponse(user);
    if (url === '/events') {
      return typeof events === 'function' ? events() : jsonResponse(events);
    }
    if (url === '/events/public' || url === '/scoresheet/templates') {
      return jsonResponse([]);
    }
    return jsonErrorResponse(404, url);
  };
}

async function confirmDelete() {
  await screen.findByRole('heading', { name: 'Delete Event' });
  const buttons = screen.getAllByRole('button', { name: 'Delete' });
  fireEvent.click(buttons[buttons.length - 1]);
}

async function submitNewEvent() {
  fireEvent.click(screen.getByRole('button', { name: '+ Create New Event' }));
  fireEvent.change(screen.getByLabelText('Event Name *'), {
    target: { value: createdEvent.name },
  });
  expect(
    (screen.getByLabelText('Event Name *') as HTMLInputElement).value,
  ).toBe(createdEvent.name);
  fireEvent.click(screen.getByRole('button', { name: 'Create Event' }));
}

describe('EventsTab mutation navigation', () => {
  it('refreshes the list before selecting a created event', async () => {
    let list: Event[] = [eventFive, eventSeven];
    const refresh = deferred<Response>();
    let created = false;
    const { fetchMock } = renderEventsTab({
      fetchImpl: stubAdmin(
        userA,
        () => refresh.promise,
        (url, init) => {
          if (init?.method === 'POST' && url === '/events') {
            created = true;
            list = [createdEvent, eventFive, eventSeven];
            return Promise.resolve(jsonResponse(createdEvent));
          }
          return undefined;
        },
      ),
    });
    refresh.resolve(jsonResponse([eventFive, eventSeven]));
    await screen.findByText('Stored Cup');

    let releaseList!: (value: Response) => void;
    const pendingList = new Promise<Response>((resolve) => {
      releaseList = resolve;
    });
    refresh.promise = pendingList;
    submitNewEvent();
    await waitFor(() => expect(created).toBe(true));
    expect(screen.getByRole('button', { name: 'Saving...' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Saving...' }));
    expect(
      fetchMock.mock.calls.filter((call) => call[1]?.method === 'POST'),
    ).toHaveLength(1);
    expect(screen.getByTestId('location').textContent).toBe(
      '/admin/events?view=events',
    );

    releaseList(jsonResponse(list));
    await screen.findByText('Event created!');
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        `/admin/events/${createdEvent.id}?view=events`,
      ),
    );
    expect(screen.getByText('Currently Selected')).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: createdEvent.name }),
    ).toBeTruthy();
  });

  it('closes a successful create without navigating when list refresh fails', async () => {
    let failList = false;
    renderEventsTab({
      fetchImpl: stubAdmin(
        userA,
        () =>
          failList
            ? Promise.resolve(jsonErrorResponse(500, 'Failed to fetch events'))
            : Promise.resolve(jsonResponse([eventFive, eventSeven])),
        (url, init) => {
          if (init?.method === 'POST' && url === '/events') {
            failList = true;
            return Promise.resolve(jsonResponse(createdEvent));
          }
          return undefined;
        },
      ),
    });
    await screen.findByText('Stored Cup');
    submitNewEvent();
    await screen.findByText('Event created!');
    expect(
      screen.queryByRole('heading', { name: 'Create New Event' }),
    ).toBeNull();
    expect(screen.getByTestId('location').textContent).toBe(
      '/admin/events?view=events',
    );
    expect(
      screen.queryByRole('heading', { name: createdEvent.name }),
    ).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId('events-error').textContent).not.toBe(''),
    );
  });

  it('does not select a created event after the user navigates away', async () => {
    let list: Event[] = [eventFive, eventSeven];
    const refresh = deferred<Response>();
    let created = false;
    renderEventsTab({
      fetchImpl: stubAdmin(
        userA,
        () => refresh.promise,
        (url, init) => {
          if (init?.method === 'POST' && url === '/events') {
            created = true;
            list = [createdEvent, eventFive, eventSeven];
            return Promise.resolve(jsonResponse(createdEvent));
          }
          return undefined;
        },
      ),
    });
    refresh.resolve(jsonResponse([eventFive, eventSeven]));
    await screen.findByText('Stored Cup');

    let releaseList!: (value: Response) => void;
    refresh.promise = new Promise<Response>((resolve) => {
      releaseList = resolve;
    });
    submitNewEvent();
    await waitFor(() => expect(created).toBe(true));
    fireEvent.click(document.querySelector('.modal.show') as Element);
    fireEvent.click(screen.getByRole('button', { name: 'Select' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        `/admin/events/${eventSeven.id}?view=events`,
      ),
    );

    releaseList(jsonResponse(list));
    await screen.findByText('Event created!');
    expect(screen.getByTestId('location').textContent).toBe(
      `/admin/events/${eventSeven.id}?view=events`,
    );
    expect(
      screen.getByRole('heading', { name: 'Deep Link Open' }),
    ).toBeTruthy();
  });

  it('does not select a created event after the originating identity changes', async () => {
    const write = deferred<Response>();
    let created = false;
    const queryClient = createTestQueryClient();
    queryClient.setQueryData(authUserKey, userA);
    renderEventsTab({
      queryClient,
      fetchImpl: async (url, init) => {
        if (url === '/auth/user') {
          const user = queryClient.getQueryData(authUserKey);
          return user ? jsonResponse(user) : jsonErrorResponse(401);
        }
        if (init?.method === 'POST' && url === '/events') {
          created = true;
          return write.promise;
        }
        if (url === '/events') return jsonResponse([eventFive]);
        if (url === '/events/public' || url === '/scoresheet/templates') {
          return jsonResponse([]);
        }
        return jsonErrorResponse(404, url);
      },
    });
    await screen.findByText('Stored Cup');
    submitNewEvent();
    await waitFor(() => expect(created).toBe(true));
    act(() => {
      queryClient.setQueryData(authUserKey, { ...userA, isAdmin: false });
    });
    write.resolve(jsonResponse(createdEvent));
    await screen.findByText('Event created!');
    expect(screen.getByTestId('location').textContent).toBe(
      '/admin/events?view=events',
    );
    expect(queryClient.getQueryData(adminEventsKey(userA.id))).toEqual([
      eventFive,
    ]);
  });

  it('selects a remaining event after deleting the current one from a refreshed list', async () => {
    let events: Event[] = [eventFive, eventSeven, eventNine];
    renderEventsTab({
      initialEntries: [`/admin/events/${eventSeven.id}?view=events`],
      fetchImpl: stubAdmin(
        userA,
        () => jsonResponse(events),
        (url, init) => {
          if (init?.method === 'DELETE' && url === `/events/${eventSeven.id}`) {
            events = [eventFive, eventNine];
            return Promise.resolve(new Response(null, { status: 204 }));
          }
          return undefined;
        },
      ),
    });
    await screen.findByRole('heading', { name: 'Deep Link Open' });
    const selectedCard = screen
      .getByText('Currently Selected')
      .closest('.card');
    expect(selectedCard).toBeTruthy();
    fireEvent.click(
      selectedCard!.querySelector('button.btn-danger') as HTMLButtonElement,
    );
    await confirmDelete();
    await screen.findByText('Event deleted!');
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Stored Cup' })).toBeTruthy(),
    );
    expect(screen.getByTestId('location').textContent).not.toContain(
      `/${eventSeven.id}`,
    );
    expect(
      screen.queryByRole('heading', { name: 'Deep Link Open' }),
    ).toBeNull();
  });

  it('returns to the event list when deleting the selection and refresh fails', async () => {
    let failList = false;
    renderEventsTab({
      initialEntries: [`/admin/events/${eventSeven.id}?view=events`],
      fetchImpl: stubAdmin(
        userA,
        () =>
          failList
            ? Promise.resolve(jsonErrorResponse(500, 'Failed to fetch events'))
            : Promise.resolve(jsonResponse([eventFive, eventSeven])),
        (url, init) => {
          if (init?.method === 'DELETE' && url === `/events/${eventSeven.id}`) {
            failList = true;
            return Promise.resolve(new Response(null, { status: 204 }));
          }
          return undefined;
        },
      ),
    });
    await screen.findByRole('heading', { name: 'Deep Link Open' });
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    await confirmDelete();
    await screen.findByText('Event deleted!');
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/admin/events?view=events',
      ),
    );
    expect(screen.getByTestId('location').textContent).not.toContain(
      `/${eventSeven.id}`,
    );
    await waitFor(() =>
      expect(screen.getByTestId('events-error').textContent).not.toBe(''),
    );
  });

  it('preserves the current selection when deleting a different event', async () => {
    let events: Event[] = [eventFive, eventSeven];
    renderEventsTab({
      initialEntries: [`/admin/events/${eventFive.id}?view=events`],
      fetchImpl: stubAdmin(
        userA,
        () => jsonResponse(events),
        (url, init) => {
          if (init?.method === 'DELETE' && url === `/events/${eventSeven.id}`) {
            events = [eventFive];
            return Promise.resolve(new Response(null, { status: 204 }));
          }
          return undefined;
        },
      ),
    });
    await screen.findByRole('heading', { name: 'Stored Cup' });
    fireEvent.click(screen.getByTitle('Delete this event'));
    await confirmDelete();
    await screen.findByText('Event deleted!');
    expect(screen.getByTestId('location').textContent).toBe(
      `/admin/events/${eventFive.id}?view=events`,
    );
    expect(screen.getByRole('heading', { name: 'Stored Cup' })).toBeTruthy();
  });
});
