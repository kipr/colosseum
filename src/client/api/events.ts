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

import { requestVoid } from './http';

export type EventInput = Partial<
  Pick<
    Event,
    | 'name'
    | 'description'
    | 'event_date'
    | 'location'
    | 'seeding_rounds'
    | 'min_rest_minutes'
    | 'score_accept_mode'
    | 'status'
    | 'spectator_results_released'
  >
>;

export function saveEvent({
  eventId,
  data,
}: {
  eventId?: number;
  data: EventInput;
}) {
  return requestJson<Event>(eventId ? `/events/${eventId}` : '/events', {
    method: eventId ? 'PATCH' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
}

export function deleteEvent({ eventId }: { eventId: number }) {
  return requestVoid(`/events/${eventId}`, { method: 'DELETE' });
}
