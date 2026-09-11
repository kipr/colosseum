import { requestJson } from './http';
import type { Event } from '../utils/eventStatus';
import type { PublicEvent } from './types';

export function getPublicEvents({
  signal,
}: { signal?: AbortSignal } = {}): Promise<PublicEvent[]> {
  return requestJson<PublicEvent[]>('/events/public', { signal });
}

export function getEvents({ signal }: { signal?: AbortSignal } = {}): Promise<
  Event[]
> {
  return requestJson<Event[]>('/events', { signal });
}
