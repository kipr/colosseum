import { ApiError } from '../api/http';
import type { SessionUser } from '../api/types';
import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';
import {
  adminScopeKey,
  authUserKey,
  judgeScopeKey,
  publicEventKey,
} from './keys';

export const ADMIN_ONLY_QUERY_META = { adminOnly: true as const };

function startsWithPrefix(queryKey: QueryKey, prefix: QueryKey): boolean {
  return (
    queryKey.length >= prefix.length &&
    prefix.every((part, index) => queryKey[index] === part)
  );
}

/**
 * Remove every cached query under a captured admin-user prefix.
 * Public and auth entries are left intact. `removeQueries` already cancels
 * in-flight retryers via `destroy()`.
 */
export function removeAdminUserQueries(
  queryClient: QueryClient,
  userId: number | string,
): void {
  queryClient.removeQueries({ queryKey: adminScopeKey(userId) });
}

/**
 * Evict queries marked admin-only for a user whose `isAdmin` permission was
 * withdrawn. Authenticated staff queries (such as the event list) remain.
 */
export function removeAdminOnlyQueries(
  queryClient: QueryClient,
  userId: number | string,
): void {
  const prefix = adminScopeKey(userId);
  queryClient.removeQueries({
    predicate: (query: Query) =>
      startsWithPrefix(query.queryKey, prefix) &&
      query.meta?.adminOnly === true,
  });
}

/**
 * Explicit `/auth/logout` destroys the server session, including any judge
 * access-code session. Remove judge Query entries for that action only.
 */
export function removeJudgeQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: [...judgeScopeKey] });
}

export function removeRestrictedPublicResults(
  queryClient: QueryClient,
  eventId: number,
): void {
  const prefix = publicEventKey(eventId);
  queryClient.removeQueries({
    predicate: (query: Query) => {
      if (!startsWithPrefix(query.queryKey, prefix)) return false;
      const rest = query.queryKey.slice(prefix.length);
      const head = rest[0];
      if (head === 'documentation' || head === 'awards' || head === 'overall') {
        return true;
      }
      return head === 'bracket' && rest[2] === 'rankings';
    },
  });
}

export function canUpdateUserCache(
  queryClient: QueryClient,
  userId: number,
  adminOnly = false,
): boolean {
  const user = queryClient.getQueryData<SessionUser | null>(authUserKey);
  return user?.id === userId && (!adminOnly || Boolean(user.isAdmin));
}

export function isAuthorizationError(error: unknown): boolean {
  return (
    error instanceof ApiError && (error.status === 401 || error.status === 403)
  );
}

export async function handleProtectedError(
  queryClient: QueryClient,
  error: unknown,
  userId: unknown,
  adminOnly = false,
): Promise<void> {
  if (!(error instanceof ApiError) || typeof userId !== 'number') return;
  if (error.status !== 401 && !(error.status === 403 && adminOnly)) return;
  if (!canUpdateUserCache(queryClient, userId)) return;
  if (error.status === 401) removeAdminUserQueries(queryClient, userId);
  else removeAdminOnlyQueries(queryClient, userId);
  if (canUpdateUserCache(queryClient, userId)) {
    await queryClient.invalidateQueries({ queryKey: authUserKey });
  }
}
