import { queryOptions } from '@tanstack/react-query';
import { getPublicEvents } from '../api/events';
import { publicEventsKey } from './keys';

export const PUBLIC_EVENTS_STALE_TIME_MS = 30_000;

export function publicEventsQueryOptions() {
  return queryOptions({
    queryKey: publicEventsKey,
    queryFn: ({ signal }) => getPublicEvents({ signal }),
    staleTime: PUBLIC_EVENTS_STALE_TIME_MS,
  });
}
