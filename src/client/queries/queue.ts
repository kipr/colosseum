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
import { POLL_INTERVAL_MS } from './queryClient';

type QueueScope = EventMutationScope & { queueItemId?: number };

export function adminQueueQueryOptions(
  userId: number,
  eventId: number,
  filters: { statuses: readonly QueueStatus[]; queueType: QueueType | 'all' },
) {
  const normalized = normalizeQueueFilters(filters);
  return queryOptions({
    queryKey: [...queueKey(userId, eventId), normalized],
    queryFn: ({ signal }) =>
      getEventQueue(
        eventId,
        {
          statuses: normalized.statuses as QueueStatus[],
          queueType: normalized.queueType as QueueType | null,
        },
        signal,
      ),
    staleTime: 0,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function judgeQueueQueryOptions(
  generation: string,
  eventId: number,
  filters: { statuses: readonly QueueStatus[]; queueType: QueueType },
) {
  const normalized = normalizeQueueFilters(filters);
  return queryOptions({
    queryKey: [...judgeEventKey(generation, eventId), 'queue', normalized],
    queryFn: ({ signal }) =>
      getEventQueue(
        eventId,
        {
          statuses: normalized.statuses as QueueStatus[],
          queueType: normalized.queueType as QueueType | null,
        },
        signal,
      ),
    staleTime: 0,
    refetchInterval: POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
  });
}

export function useQueueMutations() {
  const client = useQueryClient();
  const refresh = async (_data: unknown, scope: QueueScope) => {
    await invalidateQueueDependents(client, scope);
  };
  const populateFromBracket = useMutation({
    mutationFn: (v: EventMutationScope & { eventId: number }) =>
      populateQueueFromBracket(v),
    onSuccess: refresh,
  });
  const populateFromSeeding = useMutation({
    mutationFn: (v: EventMutationScope & { eventId: number }) =>
      populateQueueFromSeeding(v),
    onSuccess: refresh,
  });
  const add = useMutation({
    mutationFn: (v: QueueScope & Parameters<typeof addQueueItem>[0]) =>
      addQueueItem(v),
    onSuccess: refresh,
  });
  const updateStatus = useMutation({
    mutationFn: (
      v: QueueScope & { queueItemId: number; status: QueueStatus },
    ) => updateQueueStatus(v),
    onSuccess: refresh,
  });
  const call = useMutation({
    mutationFn: (v: QueueScope & { queueItemId: number }) => callQueueItem(v),
    onSuccess: refresh,
  });
  const updatePresence = useMutation({
    mutationFn: (
      v: QueueScope & { queueItemId: number; teamId: number; present: boolean },
    ) => updateQueuePresence(v),
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
