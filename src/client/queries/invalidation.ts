import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';
import { adminScopeKey, judgeScopeKey } from './keys';

export const ADMIN_ONLY_QUERY_META = { adminOnly: true as const };

function startsWithPrefix(queryKey: QueryKey, prefix: QueryKey): boolean {
  return (
    queryKey.length >= prefix.length &&
    prefix.every((part, index) => queryKey[index] === part)
  );
}

async function cancelThenRemove(
  queryClient: QueryClient,
  filters: { queryKey?: QueryKey; predicate?: (query: Query) => boolean },
): Promise<void> {
  await queryClient.cancelQueries(filters);
  queryClient.removeQueries(filters);
}

/**
 * Cancel, then remove, every cached query under a captured admin-user prefix.
 * Public and auth entries are left intact.
 */
export async function removeAdminUserQueries(
  queryClient: QueryClient,
  userId: number | string,
): Promise<void> {
  await cancelThenRemove(queryClient, { queryKey: adminScopeKey(userId) });
}

/**
 * Evict queries marked admin-only for a user whose `isAdmin` permission was
 * withdrawn. Authenticated staff queries (such as the event list) remain.
 */
export async function removeAdminOnlyQueries(
  queryClient: QueryClient,
  userId: number | string,
): Promise<void> {
  const prefix = adminScopeKey(userId);
  const predicate = (query: Query) =>
    startsWithPrefix(query.queryKey, prefix) && query.meta?.adminOnly === true;
  await cancelThenRemove(queryClient, { predicate });
}

/**
 * Explicit `/auth/logout` destroys the server session, including any judge
 * access-code session. Cancel/remove judge Query entries for that action only.
 */
export async function removeJudgeQueries(
  queryClient: QueryClient,
): Promise<void> {
  await cancelThenRemove(queryClient, { queryKey: [...judgeScopeKey] });
}
