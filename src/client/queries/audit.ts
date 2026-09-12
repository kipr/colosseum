import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query';
import { getAuditLogs, getEntityHistory } from '../api/audit';
import { auditEntityKey, auditKey } from './keys';
import { ADMIN_ONLY_QUERY_META } from './invalidation';
import { RESULT_STALE_TIME_MS } from './queryClient';

export const AUDIT_PAGE_SIZE = 50;

export function auditHistoryQueryOptions(
  userId: number,
  eventId: number,
  filters: { action: string; entityType: string },
  pageSize = AUDIT_PAGE_SIZE,
) {
  return infiniteQueryOptions({
    queryKey: [
      ...auditKey(userId, eventId),
      { action: filters.action, entityType: filters.entityType, pageSize },
    ],
    queryFn: ({ pageParam, signal }) =>
      getAuditLogs(
        eventId,
        {
          limit: pageSize,
          offset: pageParam,
          action: filters.action || undefined,
          entityType: filters.entityType || undefined,
        },
        signal,
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) =>
      lastPage.length === pageSize
        ? allPages.reduce((total, page) => total + page.length, 0)
        : undefined,
    staleTime: RESULT_STALE_TIME_MS,
    meta: ADMIN_ONLY_QUERY_META,
  });
}

export function entityHistoryQueryOptions(
  userId: number,
  entityType: string,
  entityId: number,
) {
  return queryOptions({
    queryKey: auditEntityKey(userId, entityType, entityId),
    queryFn: ({ signal }) =>
      getEntityHistory(entityType, entityId, AUDIT_PAGE_SIZE, signal),
    staleTime: RESULT_STALE_TIME_MS,
    meta: ADMIN_ONLY_QUERY_META,
  });
}
