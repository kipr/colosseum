import { readStoredJudgeGeneration } from '../utils/judgeSession';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import {
  adminEventKey,
  adminScopeKey,
  publicEventKey,
  publicEventsKey,
  queueKey,
} from './keys';
import { canUpdateUserCache } from './authorization';

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

export function canUpdateJudgeCache(generation: string): boolean {
  return readStoredJudgeGeneration() === generation;
}

// Preserve existing imports while keeping authorization cleanup implemented in
// a module that startup can load without pulling in domain invalidation helpers.
export {
  ADMIN_ONLY_QUERY_META,
  canUpdateUserCache,
  handleProtectedError,
  isAuthorizationError,
  removeAdminOnlyQueries,
  removeAdminUserQueries,
  removeJudgeQueries,
  removeRestrictedPublicResults,
} from './authorization';
