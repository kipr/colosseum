// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Spectator from '../../src/client/pages/Spectator';
import type { PublicEvent } from '../../src/client/utils/spectatorEvents';

vi.mock('../../src/client/components/Navbar', () => ({
  default: () => createElement('h1', null, 'Colosseum'),
}));
// These tests exercise routing/loading; populated table rendering is covered by
// the display component tests and the anonymous browser suite.
vi.mock('../../src/client/components/seeding/SeedingDisplay', () => ({
  default: (props: unknown) =>
    createElement('pre', { 'data-display': 'seeding' }, JSON.stringify(props)),
}));
vi.mock('../../src/client/components/bracket/BracketLikeView', () => ({
  default: (props: unknown) =>
    createElement('pre', { 'data-display': 'bracket' }, JSON.stringify(props)),
}));
vi.mock('../../src/client/components/bracket/BracketRankingView', () => ({
  default: (props: unknown) =>
    createElement('pre', { 'data-display': 'rankings' }, JSON.stringify(props)),
}));
vi.mock(
  '../../src/client/components/documentation/DocumentationScoresDisplay',
  () => ({
    default: (props: unknown) =>
      createElement(
        'pre',
        { 'data-display': 'documentation' },
        JSON.stringify(props),
      ),
  }),
);
vi.mock('../../src/client/components/overall/OverallScoresDisplay', () => ({
  default: (props: unknown) =>
    createElement('pre', { 'data-display': 'overall' }, JSON.stringify(props)),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

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
let requests: Request[];
let container: HTMLDivElement;
let root: Root | null;
let navigate: ReturnType<typeof useNavigate>;
let location: ReturnType<typeof useLocation>;

function event(id: number, overrides: Partial<PublicEvent> = {}): PublicEvent {
  return {
    id,
    name: `Event ${id} Ω <script>literal</script>`,
    status: 'complete',
    event_date: '2026-06-15',
    location: `Arena ${id}`,
    seeding_rounds: 4,
    double_seeding_rounds: 2,
    final_scores_available: true,
    spectator_listing: 'archive',
    season_id: 701,
    season_name: 'Season 701',
    season_sort_order: 80,
    ...overrides,
  };
}

function RouterProbe() {
  navigate = useNavigate();
  location = useLocation();
  return null;
}

async function render(path = '/spectator/events/11') {
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
            path: '/spectator/events/:eventId',
            element: createElement(Spectator),
          }),
          createElement(Route, {
            path: '/spectator/events/:eventId/brackets/:bracketId',
            element: createElement(Spectator),
          }),
        ),
      ),
    );
  });
}

function request(path: string, index = 0) {
  const matches = requests.filter((r) => r.path === path);
  expect(matches.length, `request ${path} #${index}`).toBeGreaterThan(index);
  return matches[index];
}
async function respond(req: Request, body: unknown, status = 200) {
  await act(async () => {
    req.response.resolve(new Response(JSON.stringify(body), { status }));
  });
}
async function metadata(selected: PublicEvent) {
  await respond(request(`/events/${selected.id}/public`), selected);
}
async function go(path: string | number) {
  await act(async () => {
    if (typeof path === 'number') navigate(path);
    else navigate(path);
  });
}
async function click(label: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === label,
  );
  expect(button, `button ${label}`).toBeDefined();
  await act(async () => button!.click());
}
function display(name: string) {
  const text = container.querySelector(`[data-display="${name}"]`)?.textContent;
  return text ? JSON.parse(text) : null;
}
function tabs() {
  return Array.from(container.querySelectorAll('.spectator-tab-btn')).map(
    (b) => b.textContent,
  );
}
function backTarget() {
  const link = container.querySelector('a.spectator-back-btn');
  return [link?.textContent, link?.getAttribute('href')];
}
function assertNoListingOrPrivilegedFallback() {
  expect(requests.some((r) => r.path.startsWith('/events/public'))).toBe(false);
  expect(requests.some((r) => /^\/events(?:\/\d+)?$/.test(r.path))).toBe(false);
}
async function liveData(id: number) {
  await respond(request(`/teams/event/${id}`), [
    { id: id * 10, team_name: `Team ${id}` },
  ]);
  await respond(request(`/seeding/scores/event/${id}`), [
    { team_id: id * 10, score: id * 100 },
  ]);
  await respond(request(`/seeding/rankings/event/${id}`), [
    { team_id: id * 10, seed_rank: 1 },
  ]);
  await respond(request(`/brackets/event/${id}`), [
    { id: 81, name: `Bracket ${id}` },
  ]);
}

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((path: string, options: RequestInit) => {
      const response = deferred<Response>();
      // Deliberately ignore abort: the loader must guard late completions itself.
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

describe('spectator selected-event loading', () => {
  it.each(['current', 'archive'] as const)(
    'loads %s metadata directly without a current list or authenticated API',
    async (spectator_listing) => {
      await render();
      expect(requests.map((r) => r.path)).toEqual(['/events/11/public']);
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        'Loading event...',
      );
      await metadata(event(11, { spectator_listing }));
      expect(container.querySelector('h2')?.textContent).toBe(event(11).name);
      expect(container.querySelector('script')).toBeNull();
      expect(container.textContent).toContain('Arena 11');
      expect(backTarget()).toEqual(
        spectator_listing === 'archive'
          ? ['← Back to Archive', '/spectator/archive']
          : ['← Current Events', '/spectator'],
      );
      await liveData(11);
      expect(display('seeding')).toMatchObject({
        effectiveRounds: 4,
        teams: [{ id: 110, team_name: 'Team 11' }],
        scores: [{ team_id: 110, score: 1100 }],
        rankings: [{ team_id: 110, seed_rank: 1 }],
      });
      assertNoListingOrPrivilegedFallback();
    },
  );

  it.each(['bad', '0', '-1', '1.5', 'Infinity', '9007199254740992', '1e2'])(
    'handles malformed event ID %s without fetching data',
    async (id) => {
      await render(`/spectator/events/${id}?view=awards`);
      expect(container.textContent).toContain('This event is unavailable.');
      expect(requests).toEqual([]);
      expect(tabs()).toEqual([]);
      expect(container.querySelector('a[href="/spectator"]')).not.toBeNull();
    },
  );

  it('keeps a public-detail 404 distinct from a retryable failure', async () => {
    await render();
    await respond(request('/events/11/public'), { error: 'Not found' }, 404);
    expect(container.textContent).toContain('This event is unavailable.');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('button')).toBeNull();
    expect(requests.map((r) => r.path)).toEqual(['/events/11/public']);
    expect(location.pathname).toBe('/spectator/events/11');
  });

  it.each(['network', '503'])(
    'retries a %s failure using only the selected public-detail endpoint',
    async (failure) => {
      await render();
      const first = request('/events/11/public');
      if (failure === 'network') {
        await act(async () => first.response.reject(new TypeError('offline')));
      } else {
        await respond(first, { error: 'internal private detail' }, 503);
      }
      expect(container.querySelector('[role="alert"]')?.textContent).toContain(
        'Unable to load this event. Please try again.',
      );
      expect(container.textContent).not.toContain('unavailable');
      expect(container.textContent).not.toContain('internal private detail');
      await click('Retry');
      expect(container.querySelector('[role="status"]')?.textContent).toBe(
        'Loading event...',
      );
      await respond(request('/events/11/public', 1), event(11));
      expect(container.querySelector('h2')?.textContent).toBe(event(11).name);
      assertNoListingOrPrivilegedFallback();
    },
  );

  it.each(['resolve', 'reject'])(
    'ignores a late metadata %s from A after navigating to B',
    async (completion) => {
      await render();
      const a = request('/events/11/public');
      await go('/spectator/events/12?view=awards');
      expect(a.signal.aborted).toBe(true);
      await metadata(
        event(12, {
          spectator_listing: 'current',
          final_scores_available: false,
        }),
      );
      if (completion === 'resolve') await respond(a, event(11));
      else
        await act(async () => a.response.reject(new TypeError('late failure')));
      expect(container.querySelector('h2')?.textContent).toBe(event(12).name);
      expect(backTarget()).toEqual(['← Current Events', '/spectator']);
      expect(tabs()).toEqual(['Seeding', 'Double Seeding', 'Bracket']);
      expect(container.textContent).not.toContain(event(11).name);
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(requests.some((r) => r.path === '/awards/event/12/public')).toBe(
        false,
      );
    },
  );

  it('clears successful metadata and results before a missing/hidden event responds', async () => {
    await render('/spectator/events/11?view=awards');
    await metadata(event(11));
    await respond(request('/awards/event/11/public'), {
      manual: [
        { name: 'A sentinel award', recipients: [], individual_recipients: [] },
      ],
      automatic: null,
    });
    expect(container.textContent).toContain('A sentinel award');
    await go('/spectator/events/12?view=awards');
    expect(container.textContent).not.toContain('A sentinel award');
    expect(container.textContent).not.toContain(event(11).name);
    expect(tabs()).toEqual([]);
    expect(backTarget()).toEqual([undefined, undefined]);
    await respond(request('/events/12/public'), { error: 'Not found' }, 404);
    expect(container.textContent).toContain('This event is unavailable.');
    expect(requests.some((r) => r.path.includes('/awards/event/12'))).toBe(
      false,
    );
  });

  it('abandons delayed event results, even when the next URL retains the same bracket ID', async () => {
    await render('/spectator/events/11/brackets/81?view=rankings');
    await metadata(event(11));
    const aRankings = request('/brackets/81/rankings/public');
    const aScores = request('/seeding/scores/event/11');
    await go('/spectator/events/12/brackets/81?view=rankings');
    expect(aRankings.signal.aborted).toBe(true);
    expect(aScores.signal.aborted).toBe(true);
    await metadata(
      event(12, {
        spectator_listing: 'current',
        final_scores_available: false,
      }),
    );
    await liveData(12);
    await respond(aRankings, {
      entries: [{ team_name: 'A private ranking', final_rank: 1 }],
      weight: 5,
    });
    await respond(aScores, [{ score: 99999 }]);
    expect(container.textContent).not.toContain('A private ranking');
    expect(display('rankings')).toBeNull();
    expect(backTarget()).toEqual(['← Current Events', '/spectator']);
    expect(
      requests.filter((r) => r.path === '/brackets/81/rankings/public'),
    ).toHaveLength(1);
  });

  it('does not retain A documentation or ordinary seeding under event B', async () => {
    await render('/spectator/events/11?view=documentation');
    await metadata(event(11));
    const aDoc = request('/documentation-scores/event/11/public');
    const aScores = request('/seeding/scores/event/11');
    await go('/spectator/events/12');
    await metadata(
      event(12, {
        spectator_listing: 'current',
        final_scores_available: false,
      }),
    );
    await liveData(12);
    await respond(aDoc, {
      categories: [{ name: 'A private category' }],
      scores: [{ team_name: 'A private team' }],
    });
    await respond(aScores, [{ score: 99999 }]);
    expect(container.textContent).not.toContain('A private');
    expect(display('seeding').scores).toEqual([{ team_id: 120, score: 1200 }]);
    expect(display('documentation')).toBeNull();
  });

  it('aborts metadata on unmount and ignores its late success', async () => {
    await render();
    const pending = request('/events/11/public');
    await act(async () => root!.unmount());
    root = null;
    expect(pending.signal.aborted).toBe(true);
    await respond(pending, event(11));
    expect(container.textContent).toBe('');
    expect(requests).toHaveLength(1);
  });

  it('aborts event-scoped results on unmount and ignores their late failure', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await render('/spectator/events/11?view=overall');
      await metadata(event(11));
      const pending = request('/events/11/overall/public');
      await act(async () => root!.unmount());
      root = null;
      expect(pending.signal.aborted).toBe(true);
      await act(async () =>
        pending.response.reject(new TypeError('late results failure')),
      );
      expect(error).not.toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe('spectator detail URL and view compatibility', () => {
  it.each([
    ['documentation', '/documentation-scores/event/11/public'],
    ['awards', '/awards/event/11/public'],
    ['overall', '/events/11/overall/public'],
    ['rankings', '/brackets/81/rankings/public'],
  ])('loads released %s directly without a listing', async (view, path) => {
    await render(
      view === 'rankings'
        ? `/spectator/events/11/brackets/81?view=${view}`
        : `/spectator/events/11?view=${view}`,
    );
    await metadata(event(11));
    expect(request(path).signal.aborted).toBe(false);
    expect(tabs()).toContain(
      view === 'rankings'
        ? 'Bracket Rankings'
        : view === 'overall'
          ? 'Overall'
          : view === 'awards'
            ? 'Awards'
            : 'Documentation',
    );
    assertNoListingOrPrivilegedFallback();
  });

  it.each(['documentation', 'awards', 'overall', 'rankings'])(
    'does not fetch or render gated %s for an unreleased bookmarked view',
    async (view) => {
      await render(
        view === 'rankings'
          ? `/spectator/events/11/brackets/81?view=${view}`
          : `/spectator/events/11?view=${view}`,
      );
      await metadata(event(11, { final_scores_available: false }));
      await liveData(11);
      expect(tabs()).toEqual(['Seeding', 'Double Seeding', 'Bracket']);
      expect(
        requests.some((r) =>
          /(?:documentation-scores|awards|overall|rankings\/public)/.test(
            r.path,
          ),
        ),
      ).toBe(false);
      expect(container.querySelector('[data-display]')).toBeNull();
    },
  );

  it('keeps double-seeding configuration, scores, URL, and browser history', async () => {
    await render('/spectator/events/11?view=double-seeding');
    await metadata(event(11, { final_scores_available: false }));
    await liveData(11);
    await respond(request('/double-seeding/scores/event/11'), [{ score: 87 }]);
    await respond(request('/double-seeding/rankings/event/11'), [
      { seed_rank: 2 },
    ]);
    expect(display('seeding')).toMatchObject({
      effectiveRounds: 2,
      scores: [{ score: 87 }],
      rankings: [{ seed_rank: 2 }],
    });
    await click('Seeding');
    expect(location.search).toBe('?view=seeding');
    expect(display('seeding').effectiveRounds).toBe(4);
    await go(-1);
    expect(location.search).toBe('?view=double-seeding');
    expect(display('seeding').scores).toEqual([{ score: 87 }]);
    expect(requests.filter((r) => r.path === '/events/11/public')).toHaveLength(
      1,
    );
  });

  it('preserves bracket side query variants and bracket switching', async () => {
    await render(
      '/spectator/events/11/brackets/81?view=bracket&side=redemption',
    );
    await metadata(event(11));
    await respond(request('/brackets/event/11'), [
      { id: 81, name: 'First' },
      { id: 82, name: 'Second' },
    ]);
    await respond(request('/brackets/81'), {
      games: [{ id: 51, status: 'pending' }],
    });
    expect(display('bracket')).toMatchObject({
      side: 'losers',
      games: [{ id: 51, status: 'pending' }],
    });
    const selector = container.querySelector('select')!;
    await act(async () => {
      selector.value = '82';
      selector.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(location.pathname).toBe('/spectator/events/11/brackets/82');
    expect(display('bracket')).toBeNull();
    await respond(request('/brackets/82'), {
      games: [{ id: 52, status: 'pending' }],
    });
    expect(display('bracket').games).toEqual([{ id: 52, status: 'pending' }]);
    assertNoListingOrPrivilegedFallback();
  });
});
