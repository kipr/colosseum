import {
  saveEvent,
  deleteEvent,
  getEvents,
  getOverallScores,
  getPublicEvents,
  getPublicOverallScores,
} from '../api/events';
import {
  adminEventKey,
  adminEventsKey,
  overallKey,
  publicEventKey,
  publicEventsKey,
  publicTemplatesKey,
  templatesKey,
} from './keys';
import {
  ADMIN_ONLY_QUERY_META,
  canUpdateUserCache,
  type MutationScope,
} from './invalidation';
import {
  useMutation,
  useQueryClient,
  queryOptions,
} from '@tanstack/react-query';
import { LIST_STALE_TIME_MS } from './queryClient';

export function publicEventsQueryOptions() {
  return queryOptions({
    queryKey: publicEventsKey,
    queryFn: ({ signal }) => getPublicEvents({ signal }),
    staleTime: LIST_STALE_TIME_MS,
  });
}

export function adminEventsQueryOptions(userId: number | string) {
  return queryOptions({
    queryKey: adminEventsKey(userId),
    queryFn: ({ signal }) => getEvents({ signal }),
    staleTime: LIST_STALE_TIME_MS,
  });
}

export function overallQueryOptions(userId: number, eventId: number) {
  return queryOptions({
    queryKey: overallKey(userId, eventId),
    queryFn: ({ signal }) => getOverallScores(eventId, signal),
  });
}

export function publicOverallQueryOptions(eventId: number) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'overall'],
    queryFn: ({ signal }) => getPublicOverallScores(eventId, signal),
  });
}

export function useEventMutations() {
  const client = useQueryClient();
  const refreshLists = (userId: number) => [
    client.invalidateQueries({ queryKey: adminEventsKey(userId) }),
    client.invalidateQueries({ queryKey: publicEventsKey }),
    client.invalidateQueries({ queryKey: publicTemplatesKey }),
  ];
  const save = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (variables: MutationScope & Parameters<typeof saveEvent>[0]) =>
      saveEvent(variables),
    onSuccess: (_event, { userId, eventId }) => {
      if (!canUpdateUserCache(client, userId, true)) return;
      return Promise.all([
        ...refreshLists(userId),
        ...(eventId != null
          ? [
              client.invalidateQueries({
                queryKey: adminEventKey(userId, eventId),
              }),
              client.invalidateQueries({
                queryKey: publicEventKey(eventId),
              }),
            ]
          : []),
      ]);
    },
  });
  const remove = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (variables: MutationScope & { eventId: number }) =>
      deleteEvent(variables),
    onSuccess: (_, { userId, eventId }) => {
      if (!canUpdateUserCache(client, userId, true)) return;
      client.removeQueries({ queryKey: adminEventKey(userId, eventId) });
      client.removeQueries({ queryKey: publicEventKey(eventId) });
      client.removeQueries({
        queryKey: [...templatesKey(userId), { eventId }],
      });
      return Promise.all(refreshLists(userId));
    },
  });
  return { save, remove };
}
