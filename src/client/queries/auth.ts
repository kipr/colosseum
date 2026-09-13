import { queryOptions } from '@tanstack/react-query';
import { getCurrentUser } from '../api/auth';
import { ApiError } from '../api/http';
import { authUserKey } from './keys';
import {
  QUERY_RETRY_LIMIT,
  exponentialRetryDelay,
  isRetryableQueryError,
} from './queryClient';

export const AUTH_RETRY_LIMIT = 10;
export const AUTH_RETRY_BASE_DELAY_MS = 1_000;
export const AUTH_RETRY_MAX_DELAY_MS = 5_000;
export const AUTH_RETRY_BACKOFF = 1.5;

export function shouldRetryAuthQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (!isRetryableQueryError(error)) return false;
  const limit =
    error instanceof ApiError && error.status === 429
      ? QUERY_RETRY_LIMIT
      : AUTH_RETRY_LIMIT;
  return failureCount < limit;
}

export function getAuthQueryRetryDelay(
  failureCount: number,
  error: unknown,
): number {
  return exponentialRetryDelay(failureCount, error, {
    base: AUTH_RETRY_BASE_DELAY_MS,
    factor: AUTH_RETRY_BACKOFF,
    max: AUTH_RETRY_MAX_DELAY_MS,
  });
}

export function authUserQueryOptions() {
  return queryOptions({
    queryKey: authUserKey,
    queryFn: ({ signal }) => getCurrentUser({ signal }),
    networkMode: 'always',
    retry: shouldRetryAuthQuery,
    retryDelay: getAuthQueryRetryDelay,
  });
}
