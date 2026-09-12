import { ApiError, requestJson } from './http';
import type { SessionUser } from './types';

/**
 * GET /auth/user. HTTP 401 is a confirmed signed-out session and maps to
 * `null`. Network, parse, and other HTTP errors propagate to the caller.
 */
export async function getCurrentUser({
  signal,
}: { signal?: AbortSignal } = {}): Promise<SessionUser | null> {
  try {
    return await requestJson<SessionUser>('/auth/user', { signal });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      return null;
    }
    throw error;
  }
}
