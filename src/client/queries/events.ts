import { queryOptions } from '@tanstack/react-query';
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
