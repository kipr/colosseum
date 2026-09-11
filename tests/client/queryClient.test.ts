import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancelledError } from '@tanstack/react-query';
import {
  ApiError,
  ApiParseError,
  requestJson,
} from '../../src/client/api/http';
import {
  QUERY_GC_TIME_MS,
  QUERY_RETRY_LIMIT,
  QUERY_RETRY_MAX_DELAY_MS,
  createQueryClient,
  getQueryRetryDelay,
  shouldRetryQuery,
} from '../../src/client/queries/queryClient';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonError(status: number, retryAfter?: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  if (retryAfter !== undefined) {
    headers.set('Retry-After', retryAfter);
  }
  return new Response(JSON.stringify({ error: 'failed' }), { status, headers });
}

describe('shouldRetryQuery', () => {
  it('retries transport failures and selected 5xx statuses up to the limit', () => {
    expect(shouldRetryQuery(0, new TypeError('Failed to fetch'))).toBe(true);
    expect(shouldRetryQuery(1, new ApiError('x', { status: 500 }))).toBe(true);
    expect(shouldRetryQuery(0, new ApiError('x', { status: 502 }))).toBe(true);
    expect(shouldRetryQuery(0, new ApiError('x', { status: 503 }))).toBe(true);
    expect(shouldRetryQuery(0, new ApiError('x', { status: 504 }))).toBe(true);
    expect(
      shouldRetryQuery(QUERY_RETRY_LIMIT, new TypeError('Failed to fetch')),
    ).toBe(false);
  });

  it('does not retry cancellation, parse failures, or ordinary 4xx errors', () => {
    expect(shouldRetryQuery(0, new DOMException('aborted', 'AbortError'))).toBe(
      false,
    );
    expect(shouldRetryQuery(0, new CancelledError())).toBe(false);
    expect(shouldRetryQuery(0, new ApiParseError())).toBe(false);
    expect(shouldRetryQuery(0, new ApiError('nope', { status: 400 }))).toBe(
      false,
    );
    expect(shouldRetryQuery(0, new ApiError('nope', { status: 401 }))).toBe(
      false,
    );
    expect(shouldRetryQuery(0, new ApiError('nope', { status: 404 }))).toBe(
      false,
    );
  });

  it('retries 429 only when Retry-After is present', () => {
    expect(shouldRetryQuery(0, new ApiError('limited', { status: 429 }))).toBe(
      false,
    );
    expect(
      shouldRetryQuery(
        0,
        new ApiError('limited', { status: 429, retryAfterMs: 1500 }),
      ),
    ).toBe(true);
    expect(
      shouldRetryQuery(
        QUERY_RETRY_LIMIT,
        new ApiError('limited', { status: 429, retryAfterMs: 1500 }),
      ),
    ).toBe(false);
  });
});

describe('getQueryRetryDelay', () => {
  it('uses Retry-After for 429 and bounded exponential backoff otherwise', () => {
    expect(
      getQueryRetryDelay(
        0,
        new ApiError('limited', { status: 429, retryAfterMs: 2500 }),
      ),
    ).toBe(2500);
    expect(getQueryRetryDelay(0, new ApiError('x', { status: 500 }))).toBe(
      1000,
    );
    expect(getQueryRetryDelay(1, new ApiError('x', { status: 500 }))).toBe(
      2000,
    );
    expect(getQueryRetryDelay(8, new TypeError('Failed to fetch'))).toBe(
      QUERY_RETRY_MAX_DELAY_MS,
    );
  });
});

describe('createQueryClient', () => {
  it('applies Stage 1 query and mutation defaults', () => {
    const client = createQueryClient();
    const defaults = client.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(0);
    expect(defaults.queries?.gcTime).toBe(QUERY_GC_TIME_MS);
    expect(defaults.queries?.refetchOnMount).toBe(true);
    expect(defaults.queries?.refetchOnWindowFocus).toBe(true);
    expect(defaults.queries?.refetchOnReconnect).toBe(true);
    expect(defaults.queries?.refetchInterval).toBe(false);
    expect(defaults.queries?.refetchIntervalInBackground).toBe(false);
    expect(defaults.queries?.retry).toBe(shouldRetryQuery);
    expect(defaults.queries?.retryDelay).toBe(getQueryRetryDelay);
    expect(defaults.mutations?.retry).toBe(0);
    expect(defaults.mutations?.networkMode).toBe('always');
  });

  it('retries transient query failures twice and not 4xx errors', async () => {
    const client = createQueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });

    const serverError = vi.fn(() => Promise.resolve(jsonError(503)));
    vi.stubGlobal('fetch', serverError);
    await expect(
      client.fetchQuery({
        queryKey: ['retry', '503'],
        queryFn: () => requestJson('/fail'),
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(serverError).toHaveBeenCalledTimes(3);

    const clientError = vi.fn(() => Promise.resolve(jsonError(404)));
    vi.stubGlobal('fetch', clientError);
    await expect(
      client.fetchQuery({
        queryKey: ['retry', '404'],
        queryFn: () => requestJson('/missing'),
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(clientError).toHaveBeenCalledTimes(1);

    const rateLimited = vi.fn(() => Promise.resolve(jsonError(429, '0')));
    vi.stubGlobal('fetch', rateLimited);
    await expect(
      client.fetchQuery({
        queryKey: ['retry', '429'],
        queryFn: () => requestJson('/limited'),
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(rateLimited).toHaveBeenCalledTimes(3);

    client.clear();
  });

  it('does not retry parse failures', async () => {
    const client = createQueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    const malformed = vi.fn(() =>
      Promise.resolve(
        new Response('not-json', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );
    vi.stubGlobal('fetch', malformed);
    await expect(
      client.fetchQuery({
        queryKey: ['retry', 'parse'],
        queryFn: () => requestJson('/bad'),
      }),
    ).rejects.toBeInstanceOf(ApiParseError);
    expect(malformed).toHaveBeenCalledTimes(1);
    client.clear();
  });
});
