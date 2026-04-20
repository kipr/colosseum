import type { EventStatus } from './eventStatus';
import type { ScoreAcceptMode } from './scoreAcceptMode';

/**
 * Canonical Event DTO matching the `events` table.
 *
 * Boolean-shaped flags are exposed as `boolean` even though SQLite stores them
 * as `0`/`1` integers (Postgres uses native booleans); both connections coerce
 * them to JS booleans before hitting this layer.
 */
export interface Event {
  id: number;
  name: string;
  description: string | null;
  event_date: string | null;
  location: string | null;
  status: EventStatus;
  seeding_rounds: number;
  score_accept_mode: ScoreAcceptMode;
  spectator_results_released: boolean;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

/**
 * Public-facing event projection (shape returned by `/events/public` and
 * `/events/:id/public`). Matches `PUBLIC_EVENT_FIELDS` in
 * `src/server/routes/events.ts` plus the derived `final_scores_available`
 * flag emitted by `toPublicEvent`.
 */
export interface PublicEvent {
  id: number;
  name: string;
  status: EventStatus;
  event_date: string | null;
  location: string | null;
  seeding_rounds: number;
  final_scores_available: boolean;
}
