/**
 * Response shape for the overall (combined) scores endpoints.
 *
 * Source of truth for:
 * - Server: `computeOverallScores()` in `src/server/services/overallScores.ts`,
 *   surfaced by `GET /events/:id/overall` (admin) and
 *   `GET /events/:id/overall/public` (spectator, gated by released results)
 *   in `src/server/routes/events.ts`. Also consumed internally by
 *   `computeAutomaticAwards()` in `src/server/services/automaticAwards.ts`.
 * - Client: `src/client/components/overall/OverallScoresDisplay.tsx`,
 *   `src/client/components/admin/OverallTab.tsx`,
 *   `src/client/pages/Spectator.tsx`.
 *
 * Each row is a per-team breakdown of the combined score:
 *   `total = doc_score + raw_seed_score + weighted_de_score`.
 *
 * Fields are `readonly` so a decoded response cannot be mutated in place.
 */

export interface OverallScoreRow {
  readonly team_id: number;
  readonly team_number: number;
  readonly team_name: string;
  readonly display_name: string | null;
  readonly doc_score: number;
  readonly raw_seed_score: number;
  readonly weighted_de_score: number;
  readonly total: number;
}

/** Response body of `GET /events/:id/overall` and `GET /events/:id/overall/public`. */
export type OverallScoresResponse = readonly OverallScoreRow[];
