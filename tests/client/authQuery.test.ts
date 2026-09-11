import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancelledError } from '@tanstack/react-query';
import { ApiError, ApiParseError } from '../../src/client/api/http';
import {
  AUTH_RETRY_LIMIT,
  AUTH_RETRY_MAX_DELAY_MS,
  authUserQueryOptions,
  getAuthQueryRetryDelay,
  shouldRetryAuthQuery,
} from '../../src/client/queries/auth';
import {
  QUERY_RETRY_LIMIT,
  createQueryClient,
} from '../../src/client/queries/queryClient';
import { jsonErrorResponse, jsonResponse } from './helpers/queryTestUtils';
import { userA } from './helpers/sessionFixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('shouldRetryAuthQuery', () => {
  it('retries transport and transient server errors up to ten times', () => {
    expect(shouldRetryAuthQuery(0, new TypeError('Failed to fetch'))).toBe(
      true,
    );
    expect(shouldRetryAuthQuery(9, new ApiError('x', { status: 503 }))).toBe(
      true,
    );
    expect(shouldRetryAuthQuery(10, new TypeError('Failed to fetch'))).toBe(
      false,
    );
    expect(
      shouldRetryAuthQuery(
        AUTH_RETRY_LIMIT,
        new ApiError('x', { status: 500 }),
      ),
    ).toBe(false);
  });

  it('does not retry cancellation, parse failures, or ordinary 4xx errors', () => {
    expect(
      shouldRetryAuthQuery(0, new DOMException('aborted', 'AbortError')),
    ).toBe(false);
    expect(shouldRetryAuthQuery(0, new CancelledError())).toBe(false);
    expect(shouldRetryAuthQuery(0, new ApiParseError())).toBe(false);
    expect(shouldRetryAuthQuery(0, new ApiError('nope', { status: 400 }))).toBe(
      false,
    );
    expect(shouldRetryAuthQuery(0, new ApiError('nope', { status: 401 }))).toBe(
      false,
    );
    expect(shouldRetryAuthQuery(0, new ApiError('nope', { status: 403 }))).toBe(
      false,
    );
  });

  it('retries 429 at most twice when Retry-After is present', () => {
    expect(
      shouldRetryAuthQuery(0, new ApiError('limited', { status: 429 })),
    ).toBe(false);
    expect(
      shouldRetryAuthQuery(
        0,
        new ApiError('limited', { status: 429, retryAfterMs: 1500 }),
      ),
    ).toBe(true);
    expect(
      shouldRetryAuthQuery(
        QUERY_RETRY_LIMIT,
        new ApiError('limited', { status: 429, retryAfterMs: 1500 }),
      ),
    ).toBe(false);
  });
});

describe('getAuthQueryRetryDelay', () => {
  it('uses 1.5 exponential backoff capped at five seconds', () => {
    expect(getAuthQueryRetryDelay(0, new TypeError('Failed to fetch'))).toBe(
      1000,
    );
    expect(getAuthQueryRetryDelay(1, new ApiError('x', { status: 503 }))).toBe(
      1500,
    );
    expect(getAuthQueryRetryDelay(2, new TypeError('Failed to fetch'))).toBe(
      2250,
    );
    expect(getAuthQueryRetryDelay(4, new TypeError('Failed to fetch'))).toBe(
      AUTH_RETRY_MAX_DELAY_MS,
    );
  });

  it('honors Retry-After for 429', () => {
    expect(
      getAuthQueryRetryDelay(
        0,
        new ApiError('limited', { status: 429, retryAfterMs: 2500 }),
      ),
    ).toBe(2500);
  });
});

describe('authUserQueryOptions', () => {
  it('retries transport failures ten times then settles as error', async () => {
    const fetchMock = vi.fn(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = createQueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });

    await expect(
      client.fetchQuery({
        ...authUserQueryOptions(),
        retryDelay: 0,
      }),
    ).rejects.toBeInstanceOf(TypeError);

    expect(fetchMock).toHaveBeenCalledTimes(AUTH_RETRY_LIMIT + 1);
    client.clear();
  });

  it('does not retry HTTP 401 mapped to null', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonErrorResponse(401)));
    vi.stubGlobal('fetch', fetchMock);
    const client = createQueryClient();

    await expect(client.fetchQuery(authUserQueryOptions())).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    client.clear();
  });

  it('forwards Query abort signal and cookie credentials', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(userA)));
    vi.stubGlobal('fetch', fetchMock);
    const client = createQueryClient();

    await expect(client.fetchQuery(authUserQueryOptions())).resolves.toEqual(
      userA,
    );
    expect(fetchMock.mock.calls[0][0]).toBe('/auth/user');
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    client.clear();
  });
});
