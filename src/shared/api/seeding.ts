/**
 * Response shapes for the event-scoped seeding endpoints.
 *
 * Source of truth for:
 * - Server: `GET /seeding/scores/event/:eventId` and
 *   `GET /seeding/rankings/event/:eventId` in `src/server/routes/seeding.ts`
 *   — base `seeding_scores` / `seeding_rankings` rows joined with the
 *   `teams` table for display columns. The recalculate endpoint
 *   `POST /seeding/rankings/recalculate/:eventId` returns the same
 *   ranking rows nested under `{ rankings: SeedingRanking[], ... }`.
 * - Client: `src/client/components/admin/SeedingTab.tsx`,
 *   `src/client/components/seeding/SeedingDisplay.tsx`,
 *   `src/client/components/seeding/SeedingScoresTable.tsx`, and
 *   `src/client/pages/Spectator.tsx` (spectator seeding view).
 */

/** One row of `GET /seeding/scores/event/:eventId`. */
export interface SeedingScore {
  readonly id: number;
  readonly team_id: number;
  readonly round_number: number;
  readonly score: number | null;

  // Joined `teams` display fields
  readonly team_number: number;
  readonly team_name: string;
  readonly display_name: string | null;
}

/** One row of `GET /seeding/rankings/event/:eventId`. */
export interface SeedingRanking {
  readonly id: number;
  readonly team_id: number;
  readonly seed_average: number | null;
  readonly seed_rank: number | null;
  readonly raw_seed_score: number | null;
  readonly tiebreaker_value: number | null;

  // Joined `teams` display fields
  readonly team_number: number;
  readonly team_name: string;
  readonly display_name: string | null;
}
