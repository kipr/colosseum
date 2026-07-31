/**
 * Shared contracts for automatic award computation, settings, and diagnostics.
 */

export type MedalKind = 'gold' | 'silver' | 'bronze';

export interface PublicAwardTeam {
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export interface MedalPlacement {
  /** 1-based place (not limited to 1–3). */
  place: number;
  /** Medal styling for places 1–3; null for deeper places. */
  medal: MedalKind | null;
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

export interface SeedingAwards {
  placements: MedalPlacement[];
}

export interface AutomaticAwardSettings {
  de_top_n: number;
  per_bracket_overall_top_n: number;
  seeding_top_n: number;
}

export const DEFAULT_AUTOMATIC_AWARD_SETTINGS: AutomaticAwardSettings = {
  de_top_n: 3,
  per_bracket_overall_top_n: 3,
  seeding_top_n: 3,
};

export interface AutomaticAwardsPublic {
  /** Double-elimination placement medals/places per bracket that has a champion (rank 1). */
  de: DeBracketAwards[];
  /** Composite overall within each bracket (doc + seed + weighted DE). */
  perBracketOverall: PerBracketOverallAwards[];
  /** Standalone seeding placements from seeding_rank. */
  seeding: SeedingAwards | null;
  /** Settings used to produce this result. */
  settings: AutomaticAwardSettings;
}

export type ZeroScoreComponent =
  | 'documentation'
  | 'seeding'
  | 'double_seeding'
  | 'weighted_de';

export interface ZeroScoreIssue {
  team_id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
  components: ZeroScoreComponent[];
}

export interface DuplicateBracketWeightIssue {
  weight: number;
  brackets: { id: number; name: string }[];
}

export interface AutomaticAwardDiagnostics {
  zeroScoreIssues: ZeroScoreIssue[];
  duplicateBracketWeights: DuplicateBracketWeightIssue[];
}

export interface AutomaticAwardsPreviewResponse {
  teamCount: number;
  settings: AutomaticAwardSettings;
  savedSettings: AutomaticAwardSettings;
  automatic: AutomaticAwardsPublic;
  diagnostics: AutomaticAwardDiagnostics;
  hasWarnings: boolean;
}

export interface ApplyAutomaticAwardsRequest extends AutomaticAwardSettings {
  /** Required when diagnostics report warnings. */
  acknowledge_warnings?: boolean;
}

export interface ApplyAutomaticAwardsResponse {
  created: number;
  removed: number;
  settings: AutomaticAwardSettings;
  diagnostics: AutomaticAwardDiagnostics;
  hasWarnings: boolean;
}

export function medalForPlace(place: number): MedalKind | null {
  if (place === 1) return 'gold';
  if (place === 2) return 'silver';
  if (place === 3) return 'bronze';
  return null;
}

export function ordinalLabel(place: number): string {
  const abs = Math.abs(place);
  const mod100 = abs % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${place}th`;
  switch (abs % 10) {
    case 1:
      return `${place}st`;
    case 2:
      return `${place}nd`;
    case 3:
      return `${place}rd`;
    default:
      return `${place}th`;
  }
}

export function hasAutomaticAwardsContent(
  auto: AutomaticAwardsPublic | null | undefined,
): boolean {
  if (!auto) return false;
  return (
    (auto.de?.length ?? 0) > 0 ||
    (auto.perBracketOverall?.length ?? 0) > 0 ||
    (auto.seeding?.placements?.length ?? 0) > 0
  );
}

export function diagnosticsHaveWarnings(
  diagnostics: AutomaticAwardDiagnostics,
): boolean {
  return (
    diagnostics.zeroScoreIssues.length > 0 ||
    diagnostics.duplicateBracketWeights.length > 0
  );
}
