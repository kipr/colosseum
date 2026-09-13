import { requestJson, requestJsonBody, requestVoid } from './http';
import type { Event } from '../utils/eventStatus';
import type { PublicEvent } from './types';

export interface OverallRow {
  team_id: number;
  team_number: number;
  team_name: string;
  doc_score: number;
  raw_seed_score: number;
  raw_double_seed_score: number;
  weighted_de_score: number;
  total: number;
}

export function getOverallScores(eventId: number, signal?: AbortSignal) {
  return requestJson<OverallRow[]>(`/events/${eventId}/overall`, { signal });
}

export function getPublicOverallScores(eventId: number, signal?: AbortSignal) {
  return requestJson<OverallRow[]>(`/events/${eventId}/overall/public`, {
    signal,
  });
}

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
  return requestJsonBody<Event>(
    eventId ? `/events/${eventId}` : '/events',
    eventId ? 'PATCH' : 'POST',
    data,
  );
}

export function deleteEvent({ eventId }: { eventId: number }) {
  return requestVoid(`/events/${eventId}`, { method: 'DELETE' });
}
