import type { PublicEvent } from '../../shared/domain/event';
import type { EventStatus } from '../../shared/domain/eventStatus';
import { isFinalScoresReleasedFor } from '../../shared/domain/eventVisibility';

// Keep this SELECT list in sync with the `PublicEvent` interface in
// `src/shared/domain/event.ts`. Adding a public field requires updating both.
export const PUBLIC_EVENT_FIELDS =
  'id, name, status, event_date, location, seeding_rounds, spectator_results_released';

// Allowed fields for PATCH /events/:id updates.
export const ALLOWED_UPDATE_FIELDS = [
  'name',
  'description',
  'event_date',
  'location',
  'status',
  'seeding_rounds',
  'score_accept_mode',
  'spectator_results_released',
];

export function toPublicEvent(row: Record<string, unknown>): PublicEvent {
  const { spectator_results_released, ...rest } = row;
  return {
    id: rest.id as number,
    name: rest.name as string,
    status: rest.status as EventStatus,
    event_date: (rest.event_date as string | null) ?? null,
    location: (rest.location as string | null) ?? null,
    seeding_rounds: rest.seeding_rounds as number,
    final_scores_available: isFinalScoresReleasedFor(
      rest.status as string,
      spectator_results_released as boolean | number | null | undefined,
    ),
  };
}
