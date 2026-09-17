import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  spectatorAwardsLoader,
  spectatorBracketIndexLoader,
  spectatorBracketLoader,
  spectatorBracketRankingsLoader,
  spectatorDocumentationLoader,
  spectatorDoubleSeedingLoader,
  spectatorEventIndexLoader,
  spectatorEventLoader,
  spectatorEventsLoader,
  spectatorOverallLoader,
  spectatorSeedingLoader,
  spectatorShouldRevalidate,
} from '../../src/client/loaders/spectatorLoaders';

const publicEvent = {
  id: 42,
  name: 'Nationals',
  status: 'complete',
  event_date: null,
  location: null,
  seeding_rounds: 3,
  double_seeding_rounds: 2,
  final_scores_available: true,
};

function args(
  url: string,
  params: Record<string, string> = {},
): Parameters<typeof spectatorEventLoader>[0] {
  return { request: new Request(url), params, context: undefined };
}

function responseFor(url: string): Response {
  if (url === '/events/public') return Response.json([publicEvent]);
  if (url === '/events/42/public') return Response.json(publicEvent);
  if (url === '/brackets/event/42') {
    return Response.json([{ id: 9, event_id: 42, name: 'A' }]);
  }
  if (url === '/teams/event/42') return Response.json([{ id: 1 }]);
  if (url === '/seeding/scores/event/42') return Response.json([{ id: 2 }]);
  if (url === '/seeding/rankings/event/42') {
    return Response.json([{ id: 3 }]);
  }
  if (url === '/double-seeding/scores/event/42') {
    return Response.json([{ id: 4 }]);
  }
  if (url === '/double-seeding/rankings/event/42') {
    return Response.json([{ id: 5 }]);
  }
  if (url === '/brackets/9') {
    return Response.json({ id: 9, event_id: 42, games: [], entries: [] });
  }
  if (url === '/brackets/9/rankings/public') {
    return Response.json({ entries: [{ id: 6 }], weight: 0.5 });
  }
  if (url === '/documentation-scores/event/42/public') {
    return Response.json({ categories: [{ id: 7 }], scores: [{ team_id: 1 }] });
  }
  if (url === '/awards/event/42/public') {
    return Response.json({
      manual: [{ name: 'Award', recipients: undefined }],
      automatic: null,
    });
  }
  if (url === '/events/42/overall/public') {
    return Response.json([{ team_id: 1 }]);
  }
  return Response.json({ error: 'Not found' }, { status: 404 });
}

describe('spectator loaders', () => {
  const fetchMock = vi.fn((input: string | URL | Request) =>
    Promise.resolve(responseFor(String(input))),
  );

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('loads the event listing with the navigation signal', async () => {
    const loaderArgs = args('https://colosseum.test/spectator');
    await expect(spectatorEventsLoader(loaderArgs)).resolves.toEqual([
      publicEvent,
    ]);
    expect(fetchMock).toHaveBeenCalledWith('/events/public', {
      signal: loaderArgs.request.signal,
    });
  });

  it('loads event metadata and brackets together', async () => {
    const loaderArgs = args('https://colosseum.test/spectator/events/42', {
      eventId: '42',
    });
    await expect(spectatorEventLoader(loaderArgs)).resolves.toMatchObject({
      event: publicEvent,
      brackets: [{ id: 9 }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('/events/42/public', {
      signal: loaderArgs.request.signal,
    });
  });

  it.each(['abc', '0', '-1', '1.5'])(
    'rejects malformed event ID %j without fetching',
    async (eventId) => {
      await expect(
        spectatorEventLoader(
          args(`https://colosseum.test/spectator/events/${eventId}`, {
            eventId,
          }),
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['seeding', 'seeding'],
    ['double-seeding', 'double-seeding'],
    ['bracket', 'brackets'],
    ['documentation', 'documentation'],
    ['awards', 'awards'],
    ['overall', 'overall'],
  ])('redirects legacy %s views to /%s', (legacyView, canonicalView) => {
    const response = spectatorEventIndexLoader(
      args(`https://colosseum.test/spectator/events/42?view=${legacyView}`, {
        eventId: '42',
      }),
    );
    expect(response.headers.get('Location')).toBe(
      `/spectator/events/42/${canonicalView}`,
    );
  });

  it('defaults an unknown legacy view to seeding', () => {
    const response = spectatorEventIndexLoader(
      args('https://colosseum.test/spectator/events/42?view=unknown', {
        eventId: '42',
      }),
    );
    expect(response.headers.get('Location')).toBe(
      '/spectator/events/42/seeding',
    );
  });

  it('loads the three seeding resources', async () => {
    const loaderArgs = args(
      'https://colosseum.test/spectator/events/42/seeding',
      {
        eventId: '42',
      },
    );
    await expect(spectatorSeedingLoader(loaderArgs)).resolves.toMatchObject({
      teams: [{ id: 1 }],
      scores: [{ id: 2 }],
      rankings: [{ id: 3 }],
    });
    for (const call of fetchMock.mock.calls) {
      expect(call[1]).toEqual({ signal: loaderArgs.request.signal });
    }
  });

  it('loads double-seeding data after checking availability', async () => {
    await expect(
      spectatorDoubleSeedingLoader(
        args('https://colosseum.test/spectator/events/42/double-seeding', {
          eventId: '42',
        }),
      ),
    ).resolves.toMatchObject({
      teams: [{ id: 1 }],
      scores: [{ id: 4 }],
      rankings: [{ id: 5 }],
    });
  });

  it('redirects unavailable double-seeding to seeding', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ ...publicEvent, double_seeding_rounds: 0 }),
    );
    await expect(
      spectatorDoubleSeedingLoader(
        args('https://colosseum.test/spectator/events/42/double-seeding', {
          eventId: '42',
        }),
      ),
    ).rejects.toMatchObject({
      status: 302,
      headers: expect.objectContaining({}),
    });
  });

  it('redirects a bracket index to the first bracket', async () => {
    await expect(
      spectatorBracketIndexLoader(
        args('https://colosseum.test/spectator/events/42/brackets', {
          eventId: '42',
        }),
      ),
    ).rejects.toSatisfy(
      (response: Response) =>
        response.headers.get('Location') === '/spectator/events/42/brackets/9',
    );
  });

  it('renders the bracket index when no brackets exist', async () => {
    fetchMock.mockResolvedValueOnce(Response.json([]));
    await expect(
      spectatorBracketIndexLoader(
        args('https://colosseum.test/spectator/events/42/brackets', {
          eventId: '42',
        }),
      ),
    ).resolves.toBeNull();
  });

  it('loads a bracket and validates its event', async () => {
    await expect(
      spectatorBracketLoader(
        args('https://colosseum.test/spectator/events/42/brackets/9', {
          eventId: '42',
          bracketId: '9',
        }),
      ),
    ).resolves.toMatchObject({ id: 9, event_id: 42 });

    fetchMock.mockResolvedValueOnce(
      Response.json({ id: 9, event_id: 99, games: [], entries: [] }),
    );
    await expect(
      spectatorBracketLoader(
        args('https://colosseum.test/spectator/events/42/brackets/9', {
          eventId: '42',
          bracketId: '9',
        }),
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('redirects legacy bracket rankings and preserves side', async () => {
    await expect(
      spectatorBracketLoader(
        args(
          'https://colosseum.test/spectator/events/42/brackets/9?view=rankings&side=redemption',
          { eventId: '42', bracketId: '9' },
        ),
      ),
    ).rejects.toSatisfy(
      (response: Response) =>
        response.headers.get('Location') ===
        '/spectator/events/42/brackets/9/rankings?side=redemption',
    );
  });

  it('removes the legacy bracket view parameter and preserves side', async () => {
    await expect(
      spectatorBracketLoader(
        args(
          'https://colosseum.test/spectator/events/42/brackets/9?view=bracket&side=finals',
          { eventId: '42', bracketId: '9' },
        ),
      ),
    ).rejects.toSatisfy(
      (response: Response) =>
        response.headers.get('Location') ===
        '/spectator/events/42/brackets/9?side=finals',
    );
  });

  it('loads each released-results view', async () => {
    const loaderArgs = args('https://colosseum.test/spectator/events/42', {
      eventId: '42',
      bracketId: '9',
    });
    await expect(
      spectatorBracketRankingsLoader(loaderArgs),
    ).resolves.toMatchObject({ entries: [{ id: 6 }], weight: 0.5 });
    await expect(
      spectatorDocumentationLoader(loaderArgs),
    ).resolves.toMatchObject({
      categories: [{ id: 7 }],
      scores: [{ team_id: 1 }],
    });
    await expect(spectatorAwardsLoader(loaderArgs)).resolves.toEqual({
      manual: [
        {
          name: 'Award',
          recipients: [],
          individual_recipients: [],
        },
      ],
      automatic: null,
    });
    await expect(spectatorOverallLoader(loaderArgs)).resolves.toEqual([
      { team_id: 1 },
    ]);
  });

  it('redirects release-gated views when results are unavailable', async () => {
    fetchMock.mockResolvedValueOnce(
      Response.json({ ...publicEvent, final_scores_available: false }),
    );
    await expect(
      spectatorDocumentationLoader(
        args('https://colosseum.test/spectator/events/42/documentation', {
          eventId: '42',
        }),
      ),
    ).rejects.toSatisfy(
      (response: Response) =>
        response.headers.get('Location') === '/spectator/events/42/seeding',
    );
  });

  it('surfaces HTTP and abort failures unchanged', async () => {
    const unavailable = new Response('Unavailable', { status: 503 });
    fetchMock.mockResolvedValueOnce(unavailable);
    await expect(
      spectatorEventsLoader(args('https://colosseum.test/spectator')),
    ).rejects.toBe(unavailable);

    const abortError = new DOMException('Aborted', 'AbortError');
    fetchMock.mockRejectedValueOnce(abortError);
    await expect(
      spectatorEventsLoader(args('https://colosseum.test/spectator')),
    ).rejects.toBe(abortError);
  });

  it('does not revalidate loaders for side-only URL changes', () => {
    expect(
      spectatorShouldRevalidate({
        currentUrl: new URL(
          'https://colosseum.test/spectator/events/42/brackets/9?side=winners',
        ),
        nextUrl: new URL(
          'https://colosseum.test/spectator/events/42/brackets/9?side=finals',
        ),
        currentParams: { eventId: '42', bracketId: '9' },
        nextParams: { eventId: '42', bracketId: '9' },
        formMethod: undefined,
        formAction: undefined,
        formEncType: undefined,
        text: undefined,
        formData: undefined,
        json: undefined,
        actionResult: undefined,
        actionStatus: undefined,
        defaultShouldRevalidate: true,
      }),
    ).toBe(false);
  });
});
