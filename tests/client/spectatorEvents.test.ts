// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SpectatorEvents from '../../src/client/pages/SpectatorEvents';
import SpectatorArchive from '../../src/client/pages/SpectatorArchive';
import {
  getSpectatorEvents,
  groupArchiveEvents,
  type PublicEvent,
} from '../../src/client/utils/spectatorEvents';
import {
  spectatorArchivePath,
  spectatorEventsPath,
} from '../../src/client/utils/routes';

vi.mock('../../src/client/components/Navbar', () => ({
  default: () =>
    createElement('header', null, createElement('h1', null, 'Colosseum')),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function event(id: number, overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id,
    name: `Event ${id}`,
    status: 'active',
    event_date: '2026-06-15',
    location: `Arena ${id}`,
    seeding_rounds: 3,
    double_seeding_rounds: 0,
    final_scores_available: false,
    spectator_listing: 'archive',
    season_id: 701,
    season_name: '1998 Ω <script>literal</script>',
    season_sort_order: 80,
    ...overrides,
  };
}

const fixture = [
  event(11, { event_date: null, location: null }),
  event(12, { name: 'Duplicate 名 <b>Final</b>', status: 'complete' }),
  event(13, {
    name: 'Duplicate 名 <b>Final</b>',
    status: 'setup',
    final_scores_available: true,
  }),
  event(14, { event_date: '1990-01-01' }),
  event(15, {
    season_id: 401,
    season_name: '2099 newest by name',
    season_sort_order: -20,
    event_date: '2099-12-31',
    final_scores_available: true,
  }),
  event(16, {
    season_id: 509,
    season_name: 'Z older tie',
    season_sort_order: 40,
  }),
  event(17, {
    season_id: 510,
    season_name: 'A newer tie',
    season_sort_order: 40,
    event_date: '1980-01-01',
  }),
  event(18, { status: 'archived', final_scores_available: true }),
  event(19, { spectator_listing: 'current', final_scores_available: true }),
  event(20, {
    spectator_listing: 'current',
    season_id: null,
    season_name: null,
    season_sort_order: null,
    event_date: null,
  }),
  event(21, {
    status: 'archived',
    season_id: 901,
    season_name: 'Hidden-only season',
    season_sort_order: 100,
  }),
  event(22, { spectator_listing: 'current', status: 'archived' }),
];
const archiveIds = [13, 12, 14, 11, 17, 16, 15];

function permutations<T>(rows: T[]) {
  return [rows, [...rows].reverse(), [...rows.slice(4), ...rows.slice(0, 4)]];
}

describe('spectator listing grouping and sorting', () => {
  it('groups only visible archive events by assignment with configured season order', () => {
    for (const rows of permutations(fixture)) {
      const groups = groupArchiveEvents(rows);
      expect(
        groups.map(({ id, name, sort_order }) => ({ id, name, sort_order })),
      ).toEqual([
        { id: 701, name: fixture[0].season_name, sort_order: 80 },
        { id: 510, name: 'A newer tie', sort_order: 40 },
        { id: 509, name: 'Z older tie', sort_order: 40 },
        { id: 401, name: '2099 newest by name', sort_order: -20 },
      ]);
      expect(groups.map((group) => group.events.map(({ id }) => id))).toEqual([
        [13, 12, 14, 11],
        [17],
        [16],
        [15],
      ]);
      expect(
        groups.flatMap((group) => group.events.map(({ id }) => id)),
      ).toEqual(archiveIds);
    }
    expect(fixture.map(({ id }) => id)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
    ]);
  });

  it('sorts dates descending, missing dates last, and equal dates by descending event ID', () => {
    const rows = [
      event(1, { event_date: null }),
      event(2),
      event(3),
      event(4, { event_date: '2027-01-01' }),
      event(5, { event_date: null }),
    ];
    for (const shuffled of permutations(rows)) {
      expect(
        getSpectatorEvents(shuffled, 'archive').map(({ id }) => id),
      ).toEqual([4, 3, 2, 5, 1]);
    }
  });

  it('does not merge duplicate season names or duplicate event names', () => {
    const groups = groupArchiveEvents([
      event(1, { season_id: 800 }),
      event(2, { season_id: 801 }),
      event(3, { name: 'Event 1', season_id: 800 }),
    ]);
    expect(
      groups.map((group) => [group.id, group.events.map(({ id }) => id)]),
    ).toEqual([
      [801, [2]],
      [800, [3, 1]],
    ]);
  });

  it('excludes wrong placement/hidden rows but never infers release from placement/status', () => {
    expect(getSpectatorEvents(fixture, 'current').map(({ id }) => id)).toEqual([
      19, 20,
    ]);
    expect(
      groupArchiveEvents([
        event(1, { status: 'setup' }),
        event(2, { status: 'active' }),
        event(3, { status: 'complete' }),
      ])[0].events.map(({ id }) => id),
    ).toEqual([3, 2, 1]);
    expect(groupArchiveEvents([])).toEqual([]);
  });

  it.each(['season_id', 'season_name', 'season_sort_order'] as const)(
    'does not invent an archive season when %s is null',
    (key) => {
      expect(groupArchiveEvents([event(1, { [key]: null })])).toEqual([]);
    },
  );

  it('provides distinct stable listing paths without changing event routes', () => {
    expect(spectatorEventsPath()).toBe('/spectator');
    expect(spectatorArchivePath()).toBe('/spectator/archive');
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Request = {
  path: string;
  signal: AbortSignal;
  response: ReturnType<typeof deferred<Response>>;
};
let container: HTMLDivElement;
let root: Root | null;
let requests: Request[];
let navigate: ReturnType<typeof useNavigate>;

function RouterProbe() {
  navigate = useNavigate();
  return null;
}

async function render(path = '/spectator/archive') {
  await act(async () => {
    root!.render(
      createElement(
        MemoryRouter,
        { initialEntries: [path] },
        createElement(RouterProbe),
        createElement(
          Routes,
          null,
          createElement(Route, {
            path: '/spectator',
            element: createElement(SpectatorEvents),
          }),
          createElement(Route, {
            path: '/spectator/archive',
            element: createElement(SpectatorArchive),
          }),
        ),
      ),
    );
  });
}

async function respond(request: Request, rows: PublicEvent[], status = 200) {
  await act(async () =>
    request.response.resolve(new Response(JSON.stringify(rows), { status })),
  );
}

async function reject(request: Request) {
  await act(async () =>
    request.response.reject(new TypeError('Network offline')),
  );
}

function cards() {
  return Array.from(
    container.querySelectorAll<HTMLAnchorElement>('.spectator-event-card'),
  );
}
function cardIds() {
  return cards().map((card) => Number(card.pathname.split('/').at(-1)));
}
function navigation(listing: 'current' | 'archive') {
  const nav = container.querySelector('nav[aria-label="Spectator listings"]');
  expect(nav).not.toBeNull();
  const links = Array.from(nav!.querySelectorAll('a'));
  expect(
    links.map((link) => [link.textContent, link.getAttribute('href')]),
  ).toEqual([
    ['Current Events', '/spectator'],
    ['Archive', '/spectator/archive'],
  ]);
  expect(
    links
      .filter((link) => link.getAttribute('aria-current') === 'page')
      .map((link) => link.textContent),
  ).toEqual([listing === 'archive' ? 'Archive' : 'Current Events']);
}
async function retry() {
  const button = container.querySelector<HTMLButtonElement>('button');
  expect(button?.textContent).toBe('Retry');
  await act(async () => button!.click());
}

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, options: RequestInit) => {
      const response = deferred<Response>();
      requests.push({ path, signal: options.signal!, response });
      return response.promise;
    }),
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe('spectator listing pages', () => {
  it('keeps archive loading distinct from empty, groups sorted rows, and uses semantic headings', async () => {
    await render();
    navigation('archive');
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      'Loading archive...',
    );
    expect(container.textContent).not.toContain('No archived events');
    expect(requests.map(({ path }) => path)).toEqual([
      '/events/public?listing=archive',
    ]);
    await respond(requests[0], fixture);
    expect(container.querySelector('main h2')?.textContent).toBe(
      'Spectator Archive',
    );
    expect(cardIds()).toEqual(archiveIds);
    const sections = Array.from(
      container.querySelectorAll('section.spectator-archive-season'),
    );
    expect(
      sections.map((section) => section.querySelector('h3')?.textContent),
    ).toEqual([
      fixture[0].season_name,
      'A newer tie',
      'Z older tie',
      '2099 newest by name',
    ]);
    for (const section of sections) {
      expect(section.getAttribute('aria-labelledby')).toBe(
        section.querySelector('h3')?.id,
      );
      expect(section.querySelectorAll('h4').length).toBeGreaterThan(0);
    }
    expect(
      new Set(sections.map((section) => section.querySelector('h3')?.id)).size,
    ).toBe(4);
    expect(container.querySelector('script, b')).toBeNull();
    expect(container.textContent).not.toContain('Hidden-only season');
    expect(
      container.querySelector('[role="status"], [role="alert"]'),
    ).toBeNull();
  });

  it.each(['current', 'archive'] as const)(
    'renders shared %s cards with literal names, stable detail links and release badges only from the flag',
    async (listing) => {
      await render(listing === 'archive' ? '/spectator/archive' : '/spectator');
      const rows = [
        event(1, {
          name: `長${'Long'.repeat(100)} <script>alert(1)</script>`,
          status: 'active',
          spectator_listing: listing,
          final_scores_available: true,
        }),
        event(2, {
          name: 'Same 名',
          status: 'complete',
          spectator_listing: listing,
          event_date: null,
          location: null,
        }),
        event(3, {
          name: 'Same 名',
          status: 'setup',
          spectator_listing: listing,
          location: '',
        }),
      ];
      await respond(requests[0], rows);
      navigation(listing);
      const displayed = cards();
      expect(cardIds()).toEqual([3, 1, 2]);
      expect(displayed.map((card) => card.getAttribute('href'))).toEqual(
        [3, 1, 2].map((id) => `/spectator/events/${id}?view=seeding`),
      );
      expect(
        displayed.map(
          (card) =>
            card.querySelector(listing === 'archive' ? 'h4' : 'h3')
              ?.textContent,
        ),
      ).toEqual([rows[2].name, rows[0].name, rows[1].name]);
      expect(
        displayed.map(
          (card) =>
            card.querySelector('.spectator-event-card-badge')?.textContent ??
            null,
        ),
      ).toEqual([null, 'Final results available', null]);
      expect(displayed[1].textContent).toContain('Jun 15, 2026');
      expect(displayed[1].textContent).toContain('Arena 1');
      expect(
        displayed[2].querySelectorAll('.spectator-event-card-detail'),
      ).toHaveLength(0);
      expect(
        displayed[0].querySelectorAll('.spectator-event-card-detail'),
      ).toHaveLength(1);
      expect(container.querySelector('script')).toBeNull();
    },
  );

  it.each(['current', 'archive'] as const)(
    'distinguishes an empty %s listing and retains navigation',
    async (listing) => {
      await render(listing === 'archive' ? '/spectator/archive' : '/spectator');
      await respond(requests[0], []);
      navigation(listing);
      expect(container.textContent).toContain(
        listing === 'archive'
          ? 'No archived events are currently available.'
          : 'No events are currently available.',
      );
      expect(
        container.querySelector('[role="status"], [role="alert"]'),
      ).toBeNull();
      expect(cards()).toHaveLength(0);
      expect(
        container.querySelectorAll('.spectator-archive-season'),
      ).toHaveLength(0);
    },
  );

  it.each([
    ['current', 'network'],
    ['archive', 'network'],
    ['current', 'server'],
    ['archive', 'server'],
  ] as const)(
    'shows an actionable %s %s failure and recovers without stale groups or duplicate cards',
    async (listing, failure) => {
      await render(listing === 'archive' ? '/spectator/archive' : '/spectator');
      if (failure === 'network') await reject(requests[0]);
      else await respond(requests[0], [], 503);
      navigation(listing);
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        listing === 'archive'
          ? 'Could not load archive events.'
          : 'Could not load current events.',
      );
      expect(container.textContent).not.toContain('No events are currently');
      expect(container.textContent).not.toContain('No archived events');
      await retry();
      expect(container.querySelector('[role="status"]')).not.toBeNull();
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(requests).toHaveLength(2);
      expect(requests[1].path).toBe(requests[0].path);
      await respond(requests[1], [event(99, { spectator_listing: listing })]);
      expect(cardIds()).toEqual([99]);
      expect(container.querySelector('[role="alert"]')).toBeNull();
    },
  );

  it('a failed retry followed by success does not keep obsolete errors/headings', async () => {
    await render();
    await reject(requests[0]);
    await retry();
    await respond(requests[1], [], 500);
    await retry();
    await respond(requests[2], []);
    expect(cards()).toHaveLength(0);
    expect(
      container.querySelector('.spectator-archive-season, [role="alert"]'),
    ).toBeNull();
    expect(container.textContent).toContain(
      'No archived events are currently available.',
    );
  });

  it.each(['resolve', 'reject'] as const)(
    'ignores a late %s after changing listings, including history navigation',
    async (settlement) => {
      await render('/spectator');
      await act(async () => navigate('/spectator/archive'));
      navigation('archive');
      expect(requests.map(({ path }) => path)).toEqual([
        '/events/public',
        '/events/public?listing=archive',
      ]);
      expect(requests[0].signal.aborted).toBe(true);
      await respond(requests[1], [event(99)]);
      if (settlement === 'resolve')
        await respond(requests[0], [
          event(1, { spectator_listing: 'current' }),
        ]);
      else await reject(requests[0]);
      expect(cardIds()).toEqual([99]);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      await act(async () => navigate(-1));
      navigation('current');
      expect(cards()).toHaveLength(0);
      expect(requests[2].path).toBe('/events/public');
      await respond(requests[2], [event(55, { spectator_listing: 'current' })]);
      expect(cardIds()).toEqual([55]);
      await act(async () => navigate(1));
      navigation('archive');
      expect(cards()).toHaveLength(0);
      expect(requests[3].path).toBe('/events/public?listing=archive');
      await respond(requests[3], [event(99)]);
      expect(cardIds()).toEqual([99]);
    },
  );

  it.each(['resolve', 'reject'] as const)(
    'aborts on unmount and ignores late %s even if fetch ignores abort',
    async (settlement) => {
      await render();
      await act(async () => root!.unmount());
      root = null;
      expect(requests[0].signal.aborted).toBe(true);
      if (settlement === 'resolve') await respond(requests[0], fixture);
      else await reject(requests[0]);
      expect(container.textContent).toBe('');
    },
  );

  it('refetches and preserves exact ordering when revisiting the archive with shuffled rows', async () => {
    await render();
    await respond(requests[0], fixture);
    expect(cardIds()).toEqual(archiveIds);
    await act(async () => navigate('/spectator'));
    await respond(requests[1], fixture);
    expect(cardIds()).toEqual([19, 20]);
    await act(async () => navigate('/spectator/archive'));
    await respond(requests[2], [...fixture].reverse());
    expect(cardIds()).toEqual(archiveIds);
  });
});
