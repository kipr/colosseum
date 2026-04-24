/**
 * Response shape for the event-scoped game-queue endpoint.
 *
 * Source of truth for:
 * - Server: `GET /queue/event/:eventId` in `src/server/routes/queue.ts` —
 *   base `game_queue` row left-joined with bracket-game, bracket, both team
 *   rows for bracket items, and the seeding team row for seeding items.
 *   Each `QueueItem` carries either the bracket fields *or* the seeding
 *   fields populated, depending on `queue_type`; the irrelevant side is
 *   `null` because of the LEFT JOIN.
 * - Client: `src/client/components/admin/QueueTab.tsx` (admin queue
 *   management) and `src/client/components/ScoresheetForm.tsx` (judge
 *   seeding queue display).
 *
 * Mutation endpoints (`POST /queue`, `PATCH /queue/:id`,
 * `PATCH /queue/:id/call`) return a single bare `game_queue` row without
 * the joined display columns; consumers there cast the response back to
 * `QueueItem` and merge the changed fields into the cached, fully-joined
 * row from the GET, so the joined columns are typed `readonly … | null`
 * here even though they are physically absent from PATCH responses.
 */

import type { QueueStatus, QueueType } from '../domain/queue';

/** One row of `GET /queue/event/:eventId`. */
export interface QueueItem {
  // Base game_queue columns
  readonly id: number;
  readonly event_id: number;
  readonly bracket_game_id: number | null;
  readonly seeding_team_id: number | null;
  readonly seeding_round: number | null;
  readonly queue_type: QueueType;
  readonly queue_position: number;
  readonly status: QueueStatus;
  readonly table_number: number | null;
  readonly called_at: string | null;
  readonly created_at: string;

  // Joined bracket-game / bracket display fields (bracket items only)
  readonly game_number: number | null;
  readonly round_name: string | null;
  readonly bracket_side: string | null;
  readonly bracket_name: string | null;
  readonly team1_number: number | null;
  readonly team1_name: string | null;
  readonly team1_display: string | null;
  readonly team2_number: number | null;
  readonly team2_name: string | null;
  readonly team2_display: string | null;

  // Joined seeding-team display fields (seeding items only)
  readonly seeding_team_number: number | null;
  readonly seeding_team_name: string | null;
  readonly seeding_team_display: string | null;
}
