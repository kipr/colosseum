import { ApiError } from '../api/http';
import type { SessionUser } from '../api/types';
import { authUserKey } from './keys';
import type { Query, QueryClient, QueryKey } from '@tanstack/react-query';
import {
  adminEventKey,
  adminEventsKey,
  adminScopeKey,
  assignedTeamsKey,
  auditEntityKey,
  auditKey,
  awardsKey,
  awardTemplatesKey,
  bracketsKey,
  documentationKey,
  doubleSeedingKey,
  globalDocCategoriesKey,
  judgeScopeKey,
  overallKey,
  publicEventKey,
  publicEventsKey,
  seedingKey,
  teamsKey,
} from './keys';

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

export async function invalidatePublicEventResults(
  queryClient: QueryClient,
  eventId: number,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: publicEventKey(eventId) }),
    queryClient.invalidateQueries({ queryKey: publicEventsKey }),
  ]);
}

export async function invalidateTeamDependents(
  queryClient: QueryClient,
  scope: EventMutationScope,
): Promise<void> {
  const { userId, eventId } = scope;
  await invalidateForUser(queryClient, userId, [
    teamsKey(userId, eventId),
    seedingKey(userId, eventId),
    doubleSeedingKey(userId, eventId),
    bracketsKey(userId, eventId),
    [...adminEventKey(userId, eventId), 'bracket'],
    assignedTeamsKey(userId, eventId),
    overallKey(userId, eventId),
    documentationKey(userId, eventId),
    awardsKey(userId, eventId),
    auditKey(userId, eventId),
    [...adminScopeKey(userId), 'audit-entity'],
  ]);
  await invalidatePublicEventResults(queryClient, eventId);
}

export async function invalidateDoubleSeedingDependents(
  queryClient: QueryClient,
  scope: EventMutationScope,
  options: { eventMetadata?: boolean } = {},
): Promise<void> {
  const { userId, eventId } = scope;
  await invalidateForUser(
    queryClient,
    userId,
    [
      doubleSeedingKey(userId, eventId),
      overallKey(userId, eventId),
      awardsKey(userId, eventId),
      [...adminEventKey(userId, eventId), 'bracket'],
      auditKey(userId, eventId),
      [...adminScopeKey(userId), 'audit-entity'],
      ...(options.eventMetadata ? [adminEventsKey(userId)] : []),
    ],
    true,
  );
  await invalidatePublicEventResults(queryClient, eventId);
}

export async function invalidateBracketDependents(
  queryClient: QueryClient,
  scope: EventMutationScope & { bracketId?: number },
): Promise<void> {
  const { userId, eventId, bracketId } = scope;
  await invalidateForUser(queryClient, userId, [
    bracketsKey(userId, eventId),
    assignedTeamsKey(userId, eventId),
    overallKey(userId, eventId),
    awardsKey(userId, eventId),
    seedingKey(userId, eventId),
    ...(bracketId != null
      ? [[...adminEventKey(userId, eventId), 'bracket', bracketId]]
      : [[...adminEventKey(userId, eventId), 'bracket']]),
  ]);
  await invalidatePublicEventResults(queryClient, eventId);
}

export async function invalidateDocumentationDependents(
  queryClient: QueryClient,
  scope: EventMutationScope,
  options: { globalCategories?: boolean } = {},
): Promise<void> {
  const { userId, eventId } = scope;
  await invalidateForUser(
    queryClient,
    userId,
    [
      documentationKey(userId, eventId),
      overallKey(userId, eventId),
      awardsKey(userId, eventId),
      [...adminEventKey(userId, eventId), 'bracket'],
      ...(options.globalCategories ? [globalDocCategoriesKey(userId)] : []),
    ],
    true,
  );
  await invalidatePublicEventResults(queryClient, eventId);
}

export async function invalidateAwardDependents(
  queryClient: QueryClient,
  scope: EventMutationScope,
  options: { templates?: boolean } = {},
): Promise<void> {
  const { userId, eventId } = scope;
  await invalidateForUser(
    queryClient,
    userId,
    [
      awardsKey(userId, eventId),
      ...(options.templates ? [awardTemplatesKey(userId)] : []),
    ],
    true,
  );
  await invalidatePublicEventResults(queryClient, eventId);
}

export async function removeRestrictedPublicResults(
  queryClient: QueryClient,
  eventId: number,
): Promise<void> {
  const prefix = publicEventKey(eventId);
  const predicate = (query: Query) => {
    if (!startsWithPrefix(query.queryKey, prefix)) return false;
    const rest = query.queryKey.slice(prefix.length);
    const head = rest[0];
    if (head === 'documentation' || head === 'awards' || head === 'overall') {
      return true;
    }
    return head === 'bracket' && rest[2] === 'rankings';
  };
  await cancelThenRemove(queryClient, { predicate });
}

export async function invalidateAuditHistory(
  queryClient: QueryClient,
  scope: EventMutationScope & { entityType?: string; entityId?: number },
): Promise<void> {
  const { userId, eventId, entityType, entityId } = scope;
  await invalidateForUser(
    queryClient,
    userId,
    [
      auditKey(userId, eventId),
      ...(entityType != null && entityId != null
        ? [auditEntityKey(userId, entityType, entityId)]
        : []),
    ],
    true,
  );
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
