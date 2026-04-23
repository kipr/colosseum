/**
 * Response shapes for the public events endpoints.
 *
 * Source of truth for:
 * - Server: `src/server/routes/events.ts` (`GET /events/public`, `GET /events/:id/public`)
 *   — produced by `toPublicEvent()` from the raw `events` row.
 * - Client: `src/client/pages/SpectatorEvents.tsx`, `src/client/pages/Spectator.tsx`.
 *
 * The `status` field reuses the canonical `EventStatus` enum from the
 * domain layer so this DTO stays compile-time linked to the schema-level
 * status set.
 */

import type { EventStatus } from '../domain/event';

export interface PublicEvent {
  readonly id: number;
  readonly name: string;
  readonly status: EventStatus;
  readonly event_date: string | null;
  readonly location: string | null;
  readonly seeding_rounds: number;
  /**
   * True only when the event is `complete` AND an admin has explicitly
   * released spectator results. See `toPublicEvent` in
   * `src/server/routes/events.ts`.
   */
  readonly final_scores_available: boolean;
}

/** Response body of `GET /events/public`. */
export type PublicEventListResponse = readonly PublicEvent[];
