import { handleProtectedError } from './invalidation';
import {
  CancelledError,
  QueryClient,
  QueryCache,
  MutationCache,
  type QueryClientConfig,
} from '@tanstack/react-query';
import { ApiError, ApiParseError } from '../api/http';

export const QUERY_GC_TIME_MS = 5 * 60 * 1000;
export const LIST_STALE_TIME_MS = 30_000;
export const RESULT_STALE_TIME_MS = 0;
export const POLL_INTERVAL_MS = 10_000;
export const QUERY_RETRY_LIMIT = 2;
export const QUERY_RETRY_BASE_DELAY_MS = 1_000;
export const QUERY_RETRY_MAX_DELAY_MS = 30_000;

const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);

export function isRetryableServerStatus(status: number): boolean {
  return RETRYABLE_STATUS.has(status);
}

export function isCancellationError(error: unknown): boolean {
  return (
    error instanceof CancelledError ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

export function isRetryableTransportError(error: unknown): boolean {
  return (
    !(error instanceof ApiError) &&
    !(error instanceof ApiParseError) &&
    !isCancellationError(error)
  );
}

export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= QUERY_RETRY_LIMIT) return false;
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

export function getQueryRetryDelay(
  failureCount: number,
  error: unknown,
): number {
  if (
    error instanceof ApiError &&
    error.status === 429 &&
    error.retryAfterMs !== undefined
  ) {
    return error.retryAfterMs;
  }
  return Math.min(
    QUERY_RETRY_BASE_DELAY_MS * 2 ** failureCount,
    QUERY_RETRY_MAX_DELAY_MS,
  );
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
        staleTime: 0,
        gcTime: QUERY_GC_TIME_MS,
        refetchOnMount: true,
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,
        refetchInterval: false,
        refetchIntervalInBackground: false,
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
