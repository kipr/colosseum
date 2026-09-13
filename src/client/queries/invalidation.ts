import { ApiError } from '../api/http';
import type { SessionUser } from '../api/types';
import { readStoredJudgeGeneration } from '../utils/judgeSession';
import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';
import {
  adminEventKey,
  adminScopeKey,
  authUserKey,
  judgeScopeKey,
  publicEventKey,
  publicEventsKey,
  queueKey,
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

/** Mutations carry their originating identity even if the component navigates. */
export interface MutationScope {
  userId: number;
}

export type EventMutationScope = MutationScope & { eventId: number };

export async function invalidateForUser(
  queryClient: QueryClient,
  userId: number,
  queryKeys: QueryKey[],
  adminOnly = false,
): Promise<void> {
  if (!canUpdateUserCache(queryClient, userId, adminOnly)) return;
  await Promise.all(
    queryKeys.map((queryKey) => queryClient.invalidateQueries({ queryKey })),
  );
}

/**
 * After an event-scoped mutation, mark the originating admin event prefix and
 * matching public event prefix stale. Query refetches active observers only, so
 * this does not eagerly fetch every admin tab. Unrelated active queries under
 * those prefixes (including chat) may refetch; queue and chat writes keep
 * narrower invalidation instead.
 *
 * Also refreshes resources that live outside those prefixes: the public event
 * list and entity-audit queries. Callers add event lists, global
 * templates/categories, or judge-session data when the write affects them.
 */
export async function invalidateEventDependents(
  queryClient: QueryClient,
  scope: { eventId: number; userId?: number },
): Promise<void> {
  const { userId, eventId } = scope;
  await Promise.all([
    userId != null
      ? invalidateForUser(queryClient, userId, [
          adminEventKey(userId, eventId),
          [...adminScopeKey(userId), 'audit-entity'],
        ])
      : Promise.resolve(),
    queryClient.invalidateQueries({ queryKey: publicEventKey(eventId) }),
    queryClient.invalidateQueries({ queryKey: publicEventsKey }),
  ]);
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

function isJudgeEventResource(
  queryKey: QueryKey,
  eventId: number,
  resource: 'queue' | 'games',
  generation?: string,
): boolean {
  return (
    queryKey[0] === 'judge' &&
    (generation == null || queryKey[1] === generation) &&
    queryKey[2] === 'event' &&
    queryKey[3] === eventId &&
    queryKey[4] === resource
  );
}

export async function invalidateQueueDependents(
  queryClient: QueryClient,
  scope: { eventId: number; userId?: number; generation?: string },
): Promise<void> {
  const { eventId, userId, generation } = scope;
  await Promise.all([
    userId != null
      ? invalidateForUser(queryClient, userId, [queueKey(userId, eventId)])
      : Promise.resolve(),
    queryClient.invalidateQueries({
      predicate: (query) =>
        isJudgeEventResource(query.queryKey, eventId, 'queue', generation) ||
        isJudgeEventResource(query.queryKey, eventId, 'games', generation),
    }),
  ]);
}

export function canUpdateUserCache(
  queryClient: QueryClient,
  userId: number,
  adminOnly = false,
): boolean {
  const user = queryClient.getQueryData<SessionUser | null>(authUserKey);
  return user?.id === userId && (!adminOnly || Boolean(user.isAdmin));
}

export function canUpdateJudgeCache(generation: string): boolean {
  return readStoredJudgeGeneration() === generation;
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
