import {
  saveEvent,
  deleteEvent,
  getEvents,
  getOverallScores,
  getPublicEvents,
  getPublicOverallScores,
} from '../api/events';
import type { Event } from '../utils/eventStatus';
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
  const refresh = (userId: number) =>
    Promise.all([
      client.invalidateQueries({ queryKey: adminEventsKey(userId) }),
      client.invalidateQueries({ queryKey: publicEventsKey }),
      client.invalidateQueries({ queryKey: publicTemplatesKey }),
    ]);
  const save = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (variables: MutationScope & Parameters<typeof saveEvent>[0]) =>
      saveEvent(variables),
    onSuccess: async (event, { userId, eventId }) => {
      if (!canUpdateUserCache(client, userId, true)) return;
      await client.cancelQueries({ queryKey: adminEventsKey(userId) });
      if (!canUpdateUserCache(client, userId, true)) return;
      client.setQueryData<Event[]>(adminEventsKey(userId), (events = []) =>
        events.some(({ id }) => id === event.id)
          ? events.map((old) => (old.id === event.id ? event : old))
          : [event, ...events],
      );
      if (eventId != null) {
        void client.invalidateQueries({
          queryKey: adminEventKey(userId, eventId),
        });
        void client.invalidateQueries({
          queryKey: publicEventKey(eventId),
        });
      }
      void refresh(userId);
    },
  });
  const remove = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (variables: MutationScope & { eventId: number }) =>
      deleteEvent(variables),
    onSuccess: async (_, { userId, eventId }) => {
      if (!canUpdateUserCache(client, userId, true)) return;
      await client.cancelQueries({ queryKey: adminEventsKey(userId) });
      await client.cancelQueries({ queryKey: adminEventKey(userId, eventId) });
      client.removeQueries({ queryKey: adminEventKey(userId, eventId) });
      await client.cancelQueries({ queryKey: publicEventKey(eventId) });
      client.removeQueries({ queryKey: publicEventKey(eventId) });
      const templateList = [...templatesKey(userId), { eventId }];
      await client.cancelQueries({ queryKey: templateList });
      client.removeQueries({ queryKey: templateList });
      if (!canUpdateUserCache(client, userId, true)) return;
      client.setQueryData<Event[]>(adminEventsKey(userId), (events) =>
        events?.filter(({ id }) => id !== eventId),
      );
      void refresh(userId);
    },
  });
  return { save, remove };
}
