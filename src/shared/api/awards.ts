/**
 * Response shape for the automatic-awards bundle returned to spectators.
 *
 * Source of truth for:
 * - Server: `computeAutomaticAwards()` in `src/server/services/automaticAwards.ts`,
 *   surfaced via `GET /awards/event/:eventId/public` (the `automatic` field of
 *   the response body) and `POST /awards/event/:eventId/automatic`.
 * - Client: `src/client/components/spectator/SpectatorAutomaticAwards.tsx`
 *   and its consumers.
 *
 * Arrays are `readonly` so decoded responses cannot be mutated in place by
 * either side.
 */

export type MedalKind = 'gold' | 'silver' | 'bronze';

export interface PublicAwardTeam {
  readonly team_number: number;
  readonly team_name: string;
  readonly display_name: string | null;
}

export interface MedalPlacement {
  readonly place: 1 | 2 | 3;
  readonly medal: MedalKind;
  readonly recipients: readonly PublicAwardTeam[];
}

export interface DeBracketAwards {
  readonly bracket_id: number;
  readonly bracket_name: string;
  readonly placements: readonly MedalPlacement[];
}

export interface PerBracketOverallAwards {
  readonly bracket_id: number;
  readonly bracket_name: string;
  readonly placements: readonly MedalPlacement[];
}

export interface EventOverallAwards {
  readonly placements: readonly MedalPlacement[];
}

export interface AutomaticAwardsPublic {
  /** Double-elimination placement medals (ranks 1–3) per bracket that has a champion (rank 1). */
  readonly de: readonly DeBracketAwards[];
  /** Composite overall within each bracket (doc + seed + weighted DE), top three score groups. */
  readonly perBracketOverall: readonly PerBracketOverallAwards[];
  /** Event-wide overall (doc + seed + sum of weighted DE across brackets). */
  readonly eventOverall: EventOverallAwards | null;
}
