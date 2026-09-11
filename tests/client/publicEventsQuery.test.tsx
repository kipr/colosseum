// @vitest-environment jsdom
import { StrictMode } from 'react';
import {
  QueryClientProvider,
  useQuery,
  CancelledError,
} from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { publicEventsQueryOptions } from '../../src/client/queries/events';
import { publicEventsKey } from '../../src/client/queries/keys';
import type { PublicEvent } from '../../src/client/api/types';
import { focusManager, onlineManager } from '@tanstack/react-query';
import {
  createTestQueryClient,
  jsonErrorResponse,
  jsonResponse,
  registerQueryTestCleanup,
  renderWithQuery,
} from './helpers/queryTestUtils';

registerQueryTestCleanup();

const sampleEvents: PublicEvent[] = [
  {
    id: 11,
    name: 'Public Open',
    status: 'active',
    event_date: '2026-06-15',
    location: 'Arena',
    seeding_rounds: 3,
    double_seeding_rounds: 0,
    final_scores_available: false,
  },
];

function stubEventsFetch(impl: () => Promise<Response>) {
  const fetchMock = vi.fn(impl);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function DualObservers() {
  useQuery(publicEventsQueryOptions());
  useQuery(publicEventsQueryOptions());
  return null;
}

function EventsProbe() {
  const query = useQuery(publicEventsQueryOptions());
  if (query.data) return <div>count:{query.data.length}</div>;
  if (query.isError) return <div>error</div>;
  return <div>pending</div>;
}

describe('publicEventsQueryOptions', () => {
  it('deduplicates concurrent fetches outside Strict Mode', async () => {
    let releases = 0;
    let release!: (value: Response) => void;
    const gate = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const fetchMock = stubEventsFetch(() => {
      releases += 1;
      return gate.then(() => jsonResponse(sampleEvents));
    });

    const queryClient = createTestQueryClient();
    renderWithQuery(<DualObservers />, { queryClient, router: false });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    release(jsonResponse(sampleEvents));
    await waitFor(() =>
      expect(queryClient.getQueryData(publicEventsKey)).toEqual(sampleEvents),
    );
    expect(releases).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('/events/public');
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it('reuses a fresh cache entry without refetching', async () => {
    const fetchMock = stubEventsFetch(() =>
      Promise.resolve(jsonResponse(sampleEvents)),
    );
    const queryClient = createTestQueryClient();

    await expect(
      queryClient.fetchQuery(publicEventsQueryOptions()),
    ).resolves.toEqual(sampleEvents);
    await expect(
      queryClient.fetchQuery(publicEventsQueryOptions()),
    ).resolves.toEqual(sampleEvents);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches after the cached entry becomes stale', async () => {
    const fetchMock = stubEventsFetch(() =>
      Promise.resolve(jsonResponse(sampleEvents)),
    );
    const queryClient = createTestQueryClient();
    await queryClient.fetchQuery(publicEventsQueryOptions());
    await queryClient.invalidateQueries({ queryKey: publicEventsKey });
    await queryClient.fetchQuery(publicEventsQueryOptions());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cancels in-flight fetches when the query is cancelled', async () => {
    let capturedSignal: AbortSignal | undefined;
    const fetchMock = stubEventsFetch((_url?: unknown, init?: RequestInit) => {
      capturedSignal = init?.signal;
      return new Promise<Response>(() => undefined);
    });
    const queryClient = createTestQueryClient();
    const pending = queryClient.fetchQuery(publicEventsQueryOptions());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    await queryClient.cancelQueries({ queryKey: publicEventsKey });
    await expect(pending).rejects.toBeInstanceOf(CancelledError);
    expect(capturedSignal?.aborted).toBe(true);
  });

  it('refetches stale queries on focus and reconnect via Query managers', async () => {
    const fetchMock = stubEventsFetch(() =>
      Promise.resolve(jsonResponse(sampleEvents)),
    );
    const queryClient = createTestQueryClient();
    await queryClient.fetchQuery(publicEventsQueryOptions());

    const { getByText } = renderWithQuery(<EventsProbe />, {
      queryClient,
      router: false,
    });
    await waitFor(() => expect(getByText('count:1')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await queryClient.invalidateQueries({
      queryKey: publicEventsKey,
      refetchType: 'none',
    });
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    await queryClient.invalidateQueries({
      queryKey: publicEventsKey,
      refetchType: 'none',
    });
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  });

  it('still settles correctly when mounted in Strict Mode', async () => {
    const fetchMock = stubEventsFetch(() =>
      Promise.resolve(jsonResponse(sampleEvents)),
    );
    const queryClient = createTestQueryClient();
    const { getByText } = render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <EventsProbe />
        </QueryClientProvider>
      </StrictMode>,
    );

    await waitFor(() => expect(getByText('count:1')).toBeTruthy());
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(queryClient.getQueryData(publicEventsKey)).toEqual(sampleEvents);
  });
});
