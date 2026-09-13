import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  addQueueItem,
  callQueueItem,
  getEventQueue,
  populateQueueFromBracket,
  populateQueueFromSeeding,
  updateQueuePresence,
  updateQueueStatus,
  type QueueStatus,
  type QueueType,
} from '../api/queue';
import { judgeEventKey, normalizeQueueFilters, queueKey } from './keys';
import { invalidateQueueDependents } from './invalidation';
import { LIVE_QUERY } from './queryClient';
type QueueFilterInput = {
  statuses: readonly QueueStatus[];
  queueType: QueueType | 'all' | null;
};

function eventQueueQueryOptions(
  queryKey: readonly unknown[],
  eventId: number,
  filters: QueueFilterInput,
) {
  const normalized = normalizeQueueFilters(filters);
  // Prefix already includes the event; callers pass queueKey / judgeEventKey.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps -- event lives in queryKey
  return queryOptions({
    queryKey: [...queryKey, normalized],
    queryFn: ({ signal }) =>
      getEventQueue(
        eventId,
        {
          statuses: normalized.statuses as QueueStatus[],
          queueType: normalized.queueType as QueueType | null,
        },
        signal,
      ),
    ...LIVE_QUERY,
  });
}

export function adminQueueQueryOptions(
  userId: number,
  eventId: number,
  filters: QueueFilterInput,
) {
  return eventQueueQueryOptions(queueKey(userId, eventId), eventId, filters);
}

export function judgeQueueQueryOptions(
  generation: string,
  eventId: number,
  filters: { statuses: readonly QueueStatus[]; queueType: QueueType },
) {
  return eventQueueQueryOptions(
    [...judgeEventKey(generation, eventId), 'queue'],
    eventId,
    filters,
  );
}

export function useQueueMutations() {
  const client = useQueryClient();
  const refresh = (
    _data: unknown,
    scope: { eventId?: number; userId?: number; generation?: string },
  ) =>
    scope.eventId == null
      ? undefined
      : invalidateQueueDependents(client, {
          ...scope,
          eventId: scope.eventId,
        });
  const write = <TVars, TData>(
    mutationFn: (variables: TVars) => Promise<TData>,
  ) =>
    useMutation({
      mutationFn,
      onSuccess: refresh as never,
    });
  return {
    populateFromBracket: write(populateQueueFromBracket),
    populateFromSeeding: write(populateQueueFromSeeding),
    add: write(addQueueItem),
    updateStatus: write(updateQueueStatus),
    call: write(callQueueItem),
    updatePresence: write(updateQueuePresence),
  };
}
