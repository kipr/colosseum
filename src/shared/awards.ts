/**
 * Shared contracts for award physical type (certificate vs trophy)
 * and per-team award load balancing helpers.
 */

export type AwardType = 'certificate' | 'trophy';

export const DEFAULT_AWARD_TYPE: AwardType = 'trophy';

export const AWARD_TYPE_LABELS: Record<AwardType, string> = {
  certificate: 'Certificate',
  trophy: 'Trophy',
};

/** Trophies count double for load-balancing purposes. */
export const AWARD_TYPE_WEIGHTS: Record<AwardType, number> = {
  certificate: 1,
  trophy: 2,
};

export interface TeamAwardCounts {
  team_id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
  certificate_count: number;
  trophy_count: number;
}

export function isAwardType(value: unknown): value is AwardType {
  return value === 'certificate' || value === 'trophy';
}

/** Weighted total used for "least awarded first" ordering. */
export function awardWeight(
  c: Pick<TeamAwardCounts, 'certificate_count' | 'trophy_count'>,
): number {
  return (
    c.certificate_count * AWARD_TYPE_WEIGHTS.certificate +
    c.trophy_count * AWARD_TYPE_WEIGHTS.trophy
  );
}

/** Ascending by weight, tie-break on team_number. */
export function compareByAwardLoad(
  a: TeamAwardCounts,
  b: TeamAwardCounts,
): number {
  const weightDiff = awardWeight(a) - awardWeight(b);
  if (weightDiff !== 0) return weightDiff;
  return a.team_number - b.team_number;
}
