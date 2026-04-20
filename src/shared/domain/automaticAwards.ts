/**
 * Public-facing shape of computed spectator awards (DE placement, per-bracket
 * composite overall, event overall). Returned by the server's
 * `computeAutomaticAwards` and rendered by the spectator UI.
 *
 * These types are the single source of truth for the API contract and must be
 * imported by both the server service and the client component (no local
 * redeclarations).
 */

export type MedalKind = 'gold' | 'silver' | 'bronze';

export interface PublicAwardTeam {
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export interface MedalPlacement {
  place: 1 | 2 | 3;
  medal: MedalKind;
  recipients: PublicAwardTeam[];
}

export interface DeBracketAwards {
  bracket_id: number;
  bracket_name: string;
  placements: MedalPlacement[];
}

export interface PerBracketOverallAwards {
  bracket_id: number;
  bracket_name: string;
  placements: MedalPlacement[];
}

export interface EventOverallAwards {
  placements: MedalPlacement[];
}

export interface AutomaticAwardsPublic {
  /** Double-elimination placement medals (ranks 1–3) per bracket that has a champion (rank 1). */
  de: DeBracketAwards[];
  /** Composite overall within each bracket (doc + seed + weighted DE), top three score groups. */
  perBracketOverall: PerBracketOverallAwards[];
  /** Event-wide overall (doc + seed + sum of weighted DE across brackets). */
  eventOverall: EventOverallAwards | null;
}
