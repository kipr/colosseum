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
import {
  invalidateQueueDependents,
  type EventMutationScope,
} from './invalidation';
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
  const refresh = (_data: unknown, scope: EventMutationScope) =>
    invalidateQueueDependents(client, scope);
  const populateFromBracket = useMutation({
    mutationFn: (variables: EventMutationScope) =>
      populateQueueFromBracket(variables),
    onSuccess: refresh,
  });
  const populateFromSeeding = useMutation({
    mutationFn: (variables: EventMutationScope) =>
      populateQueueFromSeeding(variables),
    onSuccess: refresh,
  });
  const add = useMutation({
    mutationFn: (
      variables: EventMutationScope & Parameters<typeof addQueueItem>[0],
    ) => addQueueItem(variables),
    onSuccess: refresh,
  });
  const updateStatus = useMutation({
    mutationFn: (
      variables: EventMutationScope & Parameters<typeof updateQueueStatus>[0],
    ) => updateQueueStatus(variables),
    onSuccess: refresh,
  });
  const call = useMutation({
    mutationFn: (
      variables: EventMutationScope & Parameters<typeof callQueueItem>[0],
    ) => callQueueItem(variables),
    onSuccess: refresh,
  });
  const updatePresence = useMutation({
    mutationFn: (
      variables: EventMutationScope & Parameters<typeof updateQueuePresence>[0],
    ) => updateQueuePresence(variables),
    onSuccess: refresh,
  });
  return {
    populateFromBracket,
    populateFromSeeding,
    add,
    updateStatus,
    call,
    updatePresence,
  };
}
