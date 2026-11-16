// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EventProvider,
  useEvent,
} from '../../src/client/contexts/EventContext';
import type { Event } from '../../src/client/utils/eventStatus';

const mocks = vi.hoisted(() => ({
  auth: {
    user: { id: 1, email: 'admin@kipr.org', name: 'Admin', isAdmin: true } as {
      id: number;
      email: string;
      name: string;
      isAdmin: boolean;
    } | null,
    loading: false,
  },
  apiFetch: vi.fn(),
}));

vi.mock('../../src/client/contexts/AuthContext', () => ({
  useAuth: () => mocks.auth,
}));
vi.mock('../../src/client/utils/api', () => ({
  apiFetch: mocks.apiFetch,
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const STORAGE_KEY = 'colosseum_selected_event_id';

function makeEvent(id: number, overrides: Partial<Event> = {}): Event {
  return {
    id,
    name: `Event ${id}`,
    description: null,
    event_date: null,
    location: null,
    status: 'active',
    spectator_listing: 'current',
    season_id: null,
    seeding_rounds: 3,
    double_seeding_rounds: 0,
    min_rest_minutes: 0,
    score_accept_mode: 'manual',
    spectator_results_released: false,
    created_by: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

let root: Root | null;
let container: HTMLDivElement;
let latest: ReturnType<typeof useEvent>;
let requests: ReturnType<typeof deferred<Event[]>>[];

function Probe() {
  latest = useEvent();
  return null;
}

async function render(content: ReactNode = null) {
  await act(async () => {
    root!.render(
      createElement(EventProvider, null, createElement(Probe), content),
    );
  });
}

async function respond(index: number, events: Event[]) {
  await act(async () => {
    requests[index].resolve(events);
  });
}

async function reject(index: number, message: string) {
  await act(async () => {
    requests[index].reject(new Error(message));
  });
}

async function initialize(events: Event[] = [makeEvent(1)]) {
  await render();
  await respond(0, events);
}

async function refresh(options?: { background?: boolean }) {
  let result!: Promise<Event[]>;
  await act(async () => {
    result = latest.refreshEvents(options);
  });
  return { result };
}

beforeEach(() => {
  mocks.auth.user = {
    id: 1,
    email: 'admin@kipr.org',
    name: 'Admin',
    isAdmin: true,
  };
  mocks.auth.loading = false;
  requests = [];
  mocks.apiFetch.mockReset();
  mocks.apiFetch.mockImplementation(() => {
    const request = deferred<Event[]>();
    requests.push(request);
    return request.promise;
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.clear();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('EventContext', () => {
  it('waits for auth and restores the saved selection', async () => {
    mocks.auth.loading = true;
    localStorage.setItem(STORAGE_KEY, '2');
    await render();
    expect(requests).toHaveLength(0);
    expect(latest.loading).toBe(true);

    mocks.auth.loading = false;
    await render();
    const events = [makeEvent(1), makeEvent(2, { status: 'archived' })];
    await respond(0, events);
    expect(mocks.apiFetch).toHaveBeenCalledWith('/events', {
      fallbackError: 'Failed to fetch events',
    });
    expect(latest).toMatchObject({
      events,
      selectedEvent: events[1],
      loading: false,
      error: null,
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('2');
  });

  it.each([null, '99'])(
    'prefers active/setup events when saved selection is %s',
    async (savedId) => {
      if (savedId) localStorage.setItem(STORAGE_KEY, savedId);
      const events = [
        makeEvent(1, { status: 'complete' }),
        makeEvent(2, { status: 'setup' }),
      ];
      await initialize(events);
      expect(latest.selectedEvent).toEqual(events[1]);
      expect(localStorage.getItem(STORAGE_KEY)).toBe('2');
    },
  );

  it('keeps hydrated content, filter input and focus mounted during a background refresh', async () => {
    function Content() {
      const { loading } = useEvent();
      return loading
        ? null
        : createElement('input', { defaultValue: 'current' });
    }

    await render(createElement(Content));
    await respond(0, [makeEvent(1)]);
    const input = container.querySelector('input')!;
    input.value = 'archive';
    input.focus();
    const saved = makeEvent(1, { spectator_listing: 'archive', season_id: 7 });
    await act(async () => latest.reconcileEvent(saved));
    const background = await refresh({ background: true });
    expect(latest).toMatchObject({
      events: [saved],
      selectedEvent: saved,
      loading: false,
      error: null,
    });
    expect(container.querySelector('input')).toBe(input);
    expect(document.activeElement).toBe(input);

    const newest = { ...saved, season_id: 9 };
    await respond(1, [newest]);
    await expect(background.result).resolves.toEqual([newest]);
    expect(latest.selectedEvent).toEqual(newest);
    expect(container.querySelector('input')).toBe(input);
    expect(input.value).toBe('archive');
    expect(document.activeElement).toBe(input);
  });

  it('treats an empty accepted event list as hydrated for background refreshes', async () => {
    await initialize([]);
    await refresh({ background: true });
    expect(latest).toMatchObject({
      events: [],
      selectedEvent: null,
      loading: false,
    });
    await respond(1, []);
    expect(latest.loading).toBe(false);
  });

  it('keeps initial loading true when a background refresh supersedes the first read', async () => {
    await render();
    const background = await refresh({ background: true });
    expect(latest.loading).toBe(true);
    await respond(0, [makeEvent(1)]);
    expect(latest).toMatchObject({
      events: [],
      selectedEvent: null,
      loading: true,
    });

    const newest = [makeEvent(2)];
    await respond(1, newest);
    await expect(background.result).resolves.toEqual(newest);
    expect(latest).toMatchObject({
      events: newest,
      selectedEvent: newest[0],
      loading: false,
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('2');
  });

  it('does not treat a failed initial read as hydration for background refreshes', async () => {
    await render();
    await reject(0, 'Initial failure');
    expect(latest.loading).toBe(false);
    await refresh({ background: true });
    expect(latest).toMatchObject({ events: [], loading: true, error: null });
    await respond(1, [makeEvent(1)]);
    expect(latest).toMatchObject({ events: [makeEvent(1)], loading: false });
  });

  it('lets the latest background refresh supersede foreground loading without accepting stale data', async () => {
    const initial = [makeEvent(1)];
    await initialize(initial);
    await refresh();
    expect(latest.loading).toBe(true);
    await refresh({ background: true });
    expect(latest.loading).toBe(false);
    await respond(1, [makeEvent(1, { name: 'Stale foreground result' })]);
    expect(latest).toMatchObject({
      events: initial,
      loading: false,
      error: null,
    });

    const newest = [makeEvent(1, { name: 'Background result' })];
    await respond(2, newest);
    expect(latest).toMatchObject({
      events: newest,
      selectedEvent: newest[0],
      loading: false,
    });
    await refresh({ background: false });
    expect(latest.loading).toBe(true);
  });

  it('reports background errors without discarding hydrated content or selection', async () => {
    const initial = [makeEvent(1)];
    await initialize(initial);
    const background = await refresh({ background: true });
    expect(latest.loading).toBe(false);
    await reject(1, 'Background failure');
    await expect(background.result).resolves.toEqual([]);
    expect(latest).toMatchObject({
      events: initial,
      selectedEvent: initial[0],
      loading: false,
      error: 'Background failure',
    });
  });

  it('only commits the last-started refresh but returns each request result', async () => {
    const initial = [makeEvent(1), makeEvent(2)];
    await initialize(initial);
    await act(async () => latest.selectEventById(2));
    const first = await refresh();
    const second = await refresh();
    const newest = [initial[0], makeEvent(2, { name: 'Newest server event' })];
    await respond(2, newest);
    await expect(second.result).resolves.toEqual(newest);

    const stale = [makeEvent(1, { name: 'Obsolete list' })];
    await respond(1, stale);
    await expect(first.result).resolves.toEqual(stale);
    expect(latest).toMatchObject({
      events: newest,
      selectedEvent: newest[1],
      loading: false,
      error: null,
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('2');
  });

  it('ignores stale errors and loading completion while the latest refresh is pending', async () => {
    const initial = [makeEvent(1)];
    await initialize(initial);
    const first = await refresh();
    const second = await refresh();
    await reject(1, 'Obsolete failure');
    await expect(first.result).resolves.toEqual([]);
    expect(latest).toMatchObject({
      events: initial,
      loading: true,
      error: null,
    });
    expect(console.error).not.toHaveBeenCalled();

    const newest = [makeEvent(1, { name: 'Latest' })];
    await respond(2, newest);
    await expect(second.result).resolves.toEqual(newest);
    expect(latest).toMatchObject({
      events: newest,
      loading: false,
      error: null,
    });
  });

  it('ignores stale success while pending and preserves the latest refresh error', async () => {
    const initial = [makeEvent(1)];
    await initialize(initial);
    await refresh();
    await refresh();
    const latestRequest = await refresh();
    await respond(1, [makeEvent(1, { name: 'Stale success while pending' })]);
    expect(latest).toMatchObject({
      events: initial,
      loading: true,
      error: null,
    });

    await reject(3, 'Latest failure');
    await expect(latestRequest.result).resolves.toEqual([]);
    await respond(2, [makeEvent(1, { name: 'Stale success after failure' })]);
    expect(latest).toMatchObject({
      events: initial,
      selectedEvent: initial[0],
      loading: false,
      error: 'Latest failure',
    });
  });

  it('initializes from the latest refresh and ignores a late initial response', async () => {
    await render();
    await refresh();
    const newest = [makeEvent(2)];
    await respond(1, newest);
    expect(latest.selectedEvent).toEqual(newest[0]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('2');

    await respond(0, [makeEvent(1)]);
    expect(latest).toMatchObject({ events: newest, selectedEvent: newest[0] });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('2');
  });

  it('reconciles the server-saved event and invalidates earlier refreshes', async () => {
    const initial = [makeEvent(1), makeEvent(2)];
    await initialize(initial);
    await refresh();
    const saved = makeEvent(1, {
      name: 'Server-saved name',
      spectator_listing: 'archive',
      season_id: 7,
      updated_at: '2026-02-01T00:00:00Z',
    });
    await act(async () => latest.reconcileEvent(saved));
    expect(latest).toMatchObject({
      events: [saved, initial[1]],
      selectedEvent: saved,
      loading: false,
      error: null,
    });

    await respond(1, initial);
    expect(latest.events).toEqual([saved, initial[1]]);
    expect(latest.selectedEvent).toEqual(saved);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1');
  });

  it('does not select a saved event after the user has selected another event', async () => {
    const initial = [makeEvent(1), makeEvent(2)];
    await initialize(initial);
    const reconcileAfterSave = latest.reconcileEvent;
    await act(async () => latest.selectEventById(2));
    const location = window.location.href;
    const saved = makeEvent(1, { spectator_listing: 'archive', season_id: 4 });
    await act(async () => reconcileAfterSave(saved));
    expect(latest.events).toEqual([saved, initial[1]]);
    expect(latest.selectedEvent).toEqual(initial[1]);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('2');
    expect(window.location.href).toBe(location);
  });

  it('upserts a new saved event without changing an existing or null selection', async () => {
    const initial = [makeEvent(1)];
    await initialize(initial);
    const added = makeEvent(2, { spectator_listing: 'archive', season_id: 7 });
    await act(async () => latest.reconcileEvent(added));
    expect(latest.events).toEqual([...initial, added]);
    expect(latest.selectedEvent).toEqual(initial[0]);

    await act(async () => latest.setSelectedEvent(null));
    const updated = { ...added, name: 'Saved again' };
    await act(async () => latest.reconcileEvent(updated));
    expect(latest.events).toEqual([...initial, updated]);
    expect(latest.selectedEvent).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('accepts a refresh started after reconciliation as the latest server truth', async () => {
    await initialize();
    await refresh();
    const saved = makeEvent(1, { spectator_listing: 'archive', season_id: 7 });
    await act(async () => latest.reconcileEvent(saved));
    const next = await refresh();
    await reject(1, 'Pre-save failure');
    expect(latest).toMatchObject({
      events: [saved],
      loading: true,
      error: null,
    });

    const newest = makeEvent(1, {
      spectator_listing: 'archive',
      season_id: 9,
      name: 'Latest server values',
    });
    await respond(2, [newest]);
    await expect(next.result).resolves.toEqual([newest]);
    expect(latest).toMatchObject({
      events: [newest],
      selectedEvent: newest,
      loading: false,
      error: null,
    });
  });

  it('preserves the selected-event deletion fallback on an accepted refresh', async () => {
    await initialize([makeEvent(1), makeEvent(2)]);
    await refresh();
    const remaining = makeEvent(2, { status: 'complete' });
    await respond(1, [remaining]);
    expect(latest.selectedEvent).toEqual(remaining);
    expect(localStorage.getItem(STORAGE_KEY)).toBe('2');

    await refresh();
    await respond(2, []);
    expect(latest.selectedEvent).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('reconciles a pending save after its UI unmounts while the provider stays mounted', async () => {
    const save = deferred<Event>();
    let finished!: Promise<void>;
    function SaveButton() {
      const { reconcileEvent } = useEvent();
      return createElement(
        'button',
        {
          onClick: () => {
            finished = save.promise.then(reconcileEvent);
          },
        },
        'Save',
      );
    }

    await render(createElement(SaveButton));
    await respond(0, [makeEvent(1)]);
    await act(async () => container.querySelector('button')!.click());
    await render();
    expect(container.querySelector('button')).toBeNull();
    const saved = makeEvent(1, { spectator_listing: 'archive', season_id: 7 });
    await act(async () => {
      save.resolve(saved);
      await finished;
    });
    expect(latest).toMatchObject({
      events: [saved],
      selectedEvent: saved,
      loading: false,
    });
  });

  it('ignores both retained and current reconciliation callbacks after logout', async () => {
    await initialize();
    const reconcileAfterSave = latest.reconcileEvent;
    mocks.auth.user = null;
    await render();
    const saved = makeEvent(1, { spectator_listing: 'archive', season_id: 7 });
    await act(async () => {
      reconcileAfterSave(saved);
      latest.reconcileEvent(saved);
    });
    expect(latest).toMatchObject({
      events: [],
      selectedEvent: null,
      loading: false,
      error: null,
    });
  });

  it('ignores previous-user callbacks without invalidating the new user refresh', async () => {
    const initial = [makeEvent(1)];
    await initialize(initial);
    const previous = latest;
    mocks.auth.user = { ...mocks.auth.user!, id: 2 };
    await render();
    let oldRead!: Promise<Event[]>;
    await act(async () => {
      previous.reconcileEvent(makeEvent(1, { name: 'Old user save' }));
      oldRead = previous.refreshEvents({ background: true });
    });
    await expect(oldRead).resolves.toEqual([]);
    expect(requests).toHaveLength(2);
    expect(latest).toMatchObject({
      events: initial,
      loading: true,
      error: null,
    });

    const nextUserEvents = [makeEvent(2)];
    await respond(1, nextUserEvents);
    expect(latest).toMatchObject({
      events: nextUserEvents,
      selectedEvent: nextUserEvents[0],
      loading: false,
    });
  });

  it.each(['loading', 'logout'] as const)(
    'retires callbacks from an earlier auth scope even if the same user returns after %s',
    async (transition) => {
      const initial = [makeEvent(1)];
      await initialize(initial);
      const previous = latest;
      const user = mocks.auth.user;
      if (transition === 'loading') mocks.auth.loading = true;
      else mocks.auth.user = null;
      await render();
      const inactiveEvents = latest.events;
      await act(async () =>
        previous.reconcileEvent(makeEvent(1, { name: 'Inactive save' })),
      );
      expect(latest.events).toEqual(inactiveEvents);

      mocks.auth.loading = false;
      mocks.auth.user = user;
      await render();
      const currentEvents = latest.events;
      let oldRead!: Promise<Event[]>;
      await act(async () => {
        previous.reconcileEvent(makeEvent(1, { name: 'Retired save' }));
        oldRead = previous.refreshEvents({ background: true });
      });
      await expect(oldRead).resolves.toEqual([]);
      expect(requests).toHaveLength(2);
      expect(latest).toMatchObject({
        events: currentEvents,
        loading: true,
        error: null,
      });

      await refresh({ background: true });
      expect(latest.loading).toBe(true);
      const newest = [makeEvent(2)];
      await respond(2, newest);
      await respond(1, initial);
      expect(latest).toMatchObject({
        events: newest,
        selectedEvent: newest[0],
        loading: false,
      });
    },
  );

  it('ignores retained callbacks after provider unmount without affecting a new provider', async () => {
    await initialize();
    const previous = latest;
    await act(async () => root!.unmount());
    root = null;
    let oldRead!: Promise<Event[]>;
    await act(async () => {
      previous.reconcileEvent(makeEvent(1, { name: 'Save after unmount' }));
      oldRead = previous.refreshEvents({ background: true });
    });
    await expect(oldRead).resolves.toEqual([]);
    expect(requests).toHaveLength(1);

    root = createRoot(container);
    await render();
    await act(async () => previous.reconcileEvent(makeEvent(1)));
    const newest = [makeEvent(2)];
    await respond(1, newest);
    expect(latest).toMatchObject({
      events: newest,
      selectedEvent: newest[0],
      loading: false,
    });
    expect(console.error).not.toHaveBeenCalled();
  });

  it('ignores pending initial reads after logout and keeps refresh callable without a user', async () => {
    await render();
    mocks.auth.user = null;
    await render();
    expect(latest).toMatchObject({
      events: [],
      selectedEvent: null,
      loading: false,
    });
    await respond(0, [makeEvent(1)]);
    const loggedOut = await refresh();
    await expect(loggedOut.result).resolves.toEqual([]);
    expect(requests).toHaveLength(1);
    expect(latest).toMatchObject({
      events: [],
      selectedEvent: null,
      loading: false,
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('ignores the previous auth scope after switching users', async () => {
    await render();
    mocks.auth.user = { ...mocks.auth.user!, id: 2 };
    await render();
    const nextUserEvents = [makeEvent(2)];
    await respond(1, nextUserEvents);
    await respond(0, [makeEvent(1)]);
    expect(latest).toMatchObject({
      events: nextUserEvents,
      selectedEvent: nextUserEvents[0],
      loading: false,
      error: null,
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe('2');
  });

  it('invalidates reads when auth becomes loading again', async () => {
    await render();
    mocks.auth.loading = true;
    await render();
    await respond(0, [makeEvent(1)]);
    expect(latest.events).toEqual([]);
    expect(latest.selectedEvent).toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    mocks.auth.loading = false;
    await render();
    await respond(1, [makeEvent(2)]);
    expect(latest.selectedEvent?.id).toBe(2);
  });

  it('does not restore selection or persist a late initial response after unmount', async () => {
    await render();
    await act(async () => root!.unmount());
    root = null;
    await respond(0, [makeEvent(1)]);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(console.error).not.toHaveBeenCalled();
  });
});
