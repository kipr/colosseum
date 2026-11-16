// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSeasons } from '../../src/client/hooks/useSeasons';
import type { ApiFetchOptions } from '../../src/client/utils/api';
import type { Season } from '../../src/client/utils/eventStatus';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

vi.mock('../../src/client/utils/api', () => ({
  apiFetch: mocks.apiFetch,
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

function season(id: number, sortOrder = 0): Season {
  return { id, name: `Season ${id}`, sort_order: sortOrder };
}

let root: Root | null;
let latest: ReturnType<typeof useSeasons>;
let renders: ReturnType<typeof useSeasons>[];
let requests: {
  signal: AbortSignal;
  response: ReturnType<typeof deferred<Season[]>>;
}[];

function Probe() {
  latest = useSeasons();
  renders.push(latest);
  return null;
}

async function render() {
  await act(async () => {
    root!.render(createElement(Probe));
  });
}

async function addSeason(saved: Season) {
  await act(async () => latest.addSeason(saved));
}

async function reload() {
  await act(async () => {
    void latest.reload();
  });
}

async function respond(index: number, seasons: Season[]) {
  await act(async () => requests[index].response.resolve(seasons));
}

async function fail(index: number, message: string) {
  await act(async () => requests[index].response.reject(new Error(message)));
}

beforeEach(() => {
  requests = [];
  renders = [];
  mocks.apiFetch.mockReset();
  // Deliberately allow responses after abort to exercise the generation guard.
  mocks.apiFetch.mockImplementation(
    (_path: string, options: ApiFetchOptions) => {
      const response = deferred<Season[]>();
      requests.push({ signal: options.signal!, response });
      return response.promise;
    },
  );
  root = createRoot(document.createElement('div'));
});

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  vi.restoreAllMocks();
});

describe('useSeasons', () => {
  it('starts empty and loads the full catalog in server order without injecting defaults', async () => {
    await render();
    expect(latest).toMatchObject({ seasons: [], loading: true, error: null });
    expect(mocks.apiFetch).toHaveBeenCalledExactlyOnceWith('/events/seasons', {
      signal: requests[0].signal,
      fallbackError: 'Could not load seasons',
    });

    const seasons = [season(7, 20), season(5, 20), season(9, -1)];
    await respond(0, seasons);
    expect(latest).toMatchObject({ seasons, loading: false, error: null });
  });

  it('merges creation before the initial GET completes without aborting or ending the full load', async () => {
    await render();
    const saved = season(13, 10);
    await addSeason(saved);
    expect(requests).toHaveLength(1);
    expect(requests[0].signal.aborted).toBe(false);
    expect(latest).toMatchObject({
      seasons: [saved],
      loading: true,
      error: null,
    });

    const earlier = season(7, 20);
    const later = season(5, 0);
    await respond(0, [earlier, later]);
    expect(latest).toMatchObject({
      seasons: [earlier, saved, later],
      loading: false,
      error: null,
    });
  });

  it('keeps a catalog failure actionable after creation and retains saved options across failed and successful retries', async () => {
    await render();
    await fail(0, 'Catalog unavailable');
    const saved = season(13, 10);
    await addSeason(saved);
    expect(latest).toMatchObject({
      seasons: [saved],
      loading: false,
      error: 'Catalog unavailable',
    });
    expect(requests).toHaveLength(1);

    await reload();
    expect(latest).toMatchObject({
      seasons: [saved],
      loading: true,
      error: null,
    });
    await fail(1, 'Catalog still unavailable');
    expect(latest).toMatchObject({
      seasons: [saved],
      loading: false,
      error: 'Catalog still unavailable',
    });

    await reload();
    expect(latest.seasons).toEqual([saved]);
    const existing = season(7, 20);
    await respond(2, [existing]);
    expect(latest).toMatchObject({
      seasons: [existing, saved],
      loading: false,
      error: null,
    });
  });

  it('upserts saved IDs, deduplicates GET results, and sorts by sort_order DESC then id DESC', async () => {
    await render();
    const high = season(1, 30);
    const tied = season(7, 20);
    const low = season(99, -1);
    await respond(0, [high, tied, low]);
    const saved = season(9, 20);
    await addSeason(saved);
    const updated = { ...saved, name: 'Saved display name' };
    await addSeason(updated);
    expect(latest.seasons).toEqual([high, updated, tied, low]);

    await reload();
    // A full response can include a locally saved ID; it must appear only once.
    await respond(1, [low, saved, tied, high]);
    expect(latest).toMatchObject({
      seasons: [high, updated, tied, low],
      loading: false,
      error: null,
    });
  });

  it.each(['success', 'failure'] as const)(
    'ignores an older refresh %s while the latest is pending, including loading completion',
    async (result) => {
      await render();
      const initial = season(1);
      await respond(0, [initial]);
      const saved = season(13, 10);
      await addSeason(saved);
      await reload();
      await reload();
      expect(requests[1].signal.aborted).toBe(true);
      expect(requests[2].signal.aborted).toBe(false);

      if (result === 'success') await respond(1, [season(99)]);
      else await fail(1, 'Stale failure');
      expect(latest).toMatchObject({
        seasons: [saved, initial],
        loading: true,
        error: null,
      });

      const newest = season(7, 20);
      await respond(2, [newest]);
      expect(latest).toMatchObject({
        seasons: [newest, saved],
        loading: false,
        error: null,
      });
    },
  );

  it.each(['success', 'failure'] as const)(
    'ignores a late refresh %s after the latest refresh succeeds',
    async (result) => {
      await render();
      await reload();
      const saved = season(13, 10);
      await addSeason(saved);
      expect(requests[1].signal.aborted).toBe(false);
      const newest = season(7, 20);
      await respond(1, [newest]);

      if (result === 'success') await respond(0, [season(99)]);
      else await fail(0, 'Stale failure');
      expect(latest).toMatchObject({
        seasons: [newest, saved],
        loading: false,
        error: null,
      });
    },
  );

  it.each(['success', 'failure'] as const)(
    'ignores a late refresh %s without clearing the latest error or saved options',
    async (result) => {
      await render();
      const saved = season(13, 10);
      await addSeason(saved);
      await reload();
      await fail(1, 'Latest failure');

      if (result === 'success') await respond(0, [season(99)]);
      else await fail(0, 'Stale failure');
      expect(latest).toMatchObject({
        seasons: [saved],
        loading: false,
        error: 'Latest failure',
      });
    },
  );

  it.each(['success', 'failure'] as const)(
    'aborts on unmount and ignores a late %s',
    async (result) => {
      const consoleError = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      await render();
      await addSeason(season(13));
      const snapshot = latest;
      const renderCount = renders.length;
      await act(async () => root!.unmount());
      root = null;
      expect(requests[0].signal.aborted).toBe(true);

      if (result === 'success') await respond(0, [season(7)]);
      else await fail(0, 'Late failure');
      expect(latest).toBe(snapshot);
      expect(renders).toHaveLength(renderCount);
      expect(consoleError).not.toHaveBeenCalled();
    },
  );
});
