import { ApiError } from '../api/http';
import type { SessionUser } from '../api/types';
import { authUserKey } from './keys';
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

/** Mutations carry their originating identity even if the component navigates. */
export interface MutationScope {
  userId: number;
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
  if (error.status === 401) await removeAdminUserQueries(queryClient, userId);
  else await removeAdminOnlyQueries(queryClient, userId);
  if (canUpdateUserCache(queryClient, userId)) {
    await queryClient.invalidateQueries({ queryKey: authUserKey });
  }
}
