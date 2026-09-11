import { queryOptions } from '@tanstack/react-query';
import { getCurrentUser } from '../api/auth';
import { ApiError, ApiParseError } from '../api/http';
import { authUserKey } from './keys';
import {
  QUERY_RETRY_LIMIT,
  isCancellationError,
  isRetryableServerStatus,
  isRetryableTransportError,
} from './queryClient';

export const AUTH_RETRY_LIMIT = 10;
export const AUTH_RETRY_BASE_DELAY_MS = 1_000;
export const AUTH_RETRY_MAX_DELAY_MS = 5_000;
export const AUTH_RETRY_BACKOFF = 1.5;

export function shouldRetryAuthQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (isCancellationError(error) || error instanceof ApiParseError) {
    return false;
  }
  if (error instanceof ApiError) {
    if (error.status === 429) {
      return (
        failureCount < QUERY_RETRY_LIMIT && error.retryAfterMs !== undefined
      );
    }
    if (isRetryableServerStatus(error.status)) {
      return failureCount < AUTH_RETRY_LIMIT;
    }
    return false;
  }
  if (!isRetryableTransportError(error)) {
    return false;
  }
  return failureCount < AUTH_RETRY_LIMIT;
}

export function getAuthQueryRetryDelay(
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
    AUTH_RETRY_BASE_DELAY_MS * AUTH_RETRY_BACKOFF ** failureCount,
    AUTH_RETRY_MAX_DELAY_MS,
  );
}

export function authUserQueryOptions() {
  return queryOptions({
    queryKey: authUserKey,
    queryFn: ({ signal }) => getCurrentUser({ signal }),
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    refetchInterval: false,
    refetchIntervalInBackground: false,
    networkMode: 'always',
    retry: shouldRetryAuthQuery,
    retryDelay: getAuthQueryRetryDelay,
  });
}
