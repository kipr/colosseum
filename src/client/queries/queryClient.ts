import { handleProtectedError } from './authorization';
import {
  CancelledError,
  QueryClient,
  QueryCache,
  MutationCache,
  type QueryClientConfig,
} from '@tanstack/react-query';
import { ApiError, ApiParseError } from '../api/http';

export const LIST_STALE_TIME_MS = 30_000;
export const POLL_INTERVAL_MS = 10_000;
export const LIVE_QUERY = { refetchInterval: POLL_INTERVAL_MS } as const;
export const QUERY_RETRY_LIMIT = 2;
export const QUERY_RETRY_BASE_DELAY_MS = 1_000;
export const QUERY_RETRY_MAX_DELAY_MS = 30_000;

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

function isRetryableServerStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

function isCancellationError(error: unknown): boolean {
  return (
    error instanceof CancelledError ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

function isRetryableTransportError(error: unknown): boolean {
  return (
    !(error instanceof ApiError) &&
    !(error instanceof ApiParseError) &&
    !isCancellationError(error)
  );
}

export function isRetryableQueryError(error: unknown): boolean {
  if (isCancellationError(error) || error instanceof ApiParseError) {
    return false;
  }
  if (error instanceof ApiError) {
    if (isRetryableServerStatus(error.status)) return true;
    if (error.status === 429) return error.retryAfterMs !== undefined;
    return false;
  }
  return isRetryableTransportError(error);
}

export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  return failureCount < QUERY_RETRY_LIMIT && isRetryableQueryError(error);
}

export function exponentialRetryDelay(
  failureCount: number,
  error: unknown,
  { base, factor, max }: { base: number; factor: number; max: number },
): number {
  if (
    error instanceof ApiError &&
    error.status === 429 &&
    error.retryAfterMs !== undefined
  ) {
    return error.retryAfterMs;
  }
  return Math.min(base * factor ** failureCount, max);
}

export function getQueryRetryDelay(
  failureCount: number,
  error: unknown,
): number {
  return exponentialRetryDelay(failureCount, error, {
    base: QUERY_RETRY_BASE_DELAY_MS,
    factor: 2,
    max: QUERY_RETRY_MAX_DELAY_MS,
  });
}

export function createQueryClient(
  options: QueryClientConfig = {},
): QueryClient {
  const queryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (query.queryKey[0] === 'admin') {
          void handleProtectedError(
            queryClient,
            error,
            query.queryKey[1],
            query.meta?.adminOnly === true,
          );
        }
      },
    }),
    mutationCache: new MutationCache({
      onError: (error, variables, _context, mutation) => {
        if (
          variables &&
          typeof variables === 'object' &&
          'userId' in variables
        ) {
          void handleProtectedError(
            queryClient,
            error,
            variables.userId,
            mutation.meta?.adminOnly === true,
          );
        }
      },
    }),
    ...options,
    defaultOptions: {
      ...options.defaultOptions,
      queries: {
        retry: shouldRetryQuery,
        retryDelay: getQueryRetryDelay,
        ...options.defaultOptions?.queries,
      },
      mutations: {
        retry: 0,
        networkMode: 'always',
        ...options.defaultOptions?.mutations,
      },
    },
  });
  return queryClient;
}
