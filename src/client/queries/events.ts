import { saveEvent, deleteEvent } from '../api/events';
import type { Event } from '../utils/eventStatus';
import { adminEventKey, publicTemplatesKey, templatesKey } from './keys';
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
import { getEvents, getPublicEvents } from '../api/events';
import { adminEventsKey, publicEventsKey } from './keys';
import { QUERY_GC_TIME_MS } from './queryClient';

export const PUBLIC_EVENTS_STALE_TIME_MS = 30_000;
export const ADMIN_EVENTS_STALE_TIME_MS = 30_000;

export function publicEventsQueryOptions() {
  return queryOptions({
    queryKey: publicEventsKey,
    queryFn: ({ signal }) => getPublicEvents({ signal }),
    staleTime: PUBLIC_EVENTS_STALE_TIME_MS,
  });
}

export function adminEventsQueryOptions(userId: number | string) {
  return queryOptions({
    queryKey: adminEventsKey(userId),
    queryFn: ({ signal }) => getEvents({ signal }),
    staleTime: ADMIN_EVENTS_STALE_TIME_MS,
    gcTime: QUERY_GC_TIME_MS,
  });
}

export function useEventMutations() {
  const client = useQueryClient();
  const refresh = async (userId: number) => {
    await Promise.all([
      client.invalidateQueries({ queryKey: adminEventsKey(userId) }),
      client.invalidateQueries({ queryKey: publicEventsKey }),
      client.invalidateQueries({ queryKey: publicTemplatesKey }),
    ]);
  };
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
      if (eventId != null)
        void client.invalidateQueries({
          queryKey: adminEventKey(userId, eventId),
        });
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
