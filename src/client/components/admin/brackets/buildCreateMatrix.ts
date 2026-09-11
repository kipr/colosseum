import type { AssignedTeam } from '../../../types/brackets';
import type {
  CreateModalDoubleSeedingRanking,
  CreateModalRanking,
  CreateModalTeam,
} from '../../../hooks/brackets';

export interface BracketCreateMatrixRow {
  team: CreateModalTeam;
  ranking: CreateModalRanking | undefined;
  doubleSeedingRanking: CreateModalDoubleSeedingRanking | undefined;
  assigned: AssignedTeam | undefined;
  hasOverlap: boolean;
}

export function compareCreateMatrixRows(
  a: BracketCreateMatrixRow,
  b: BracketCreateMatrixRow,
  doubleSeedingEnabled: boolean,
): number {
  if (doubleSeedingEnabled) {
    const combinedA =
      a.ranking?.seed_average != null &&
      a.doubleSeedingRanking?.seed_average != null
        ? a.ranking.seed_average + a.doubleSeedingRanking.seed_average
        : null;
    const combinedB =
      b.ranking?.seed_average != null &&
      b.doubleSeedingRanking?.seed_average != null
        ? b.ranking.seed_average + b.doubleSeedingRanking.seed_average
        : null;
    if (combinedA != null && combinedB != null && combinedA !== combinedB)
      return combinedB - combinedA;
    if (combinedA == null && combinedB != null) return 1;
    if (combinedA != null && combinedB == null) return -1;
  }
  const rankA = a.ranking?.seed_rank;
  const rankB = b.ranking?.seed_rank;
  if (rankA == null && rankB == null)
    return a.team.team_number - b.team.team_number;
  if (rankA == null) return 1;
  if (rankB == null) return -1;
  return rankA - rankB;
}

export function buildCreateMatrixRows(input: {
  teams: CreateModalTeam[];
  rankings: CreateModalRanking[];
  doubleSeedingRankings: CreateModalDoubleSeedingRanking[];
  assigned: AssignedTeam[];
  selectedTeamIds: Set<number>;
  doubleSeedingEnabled: boolean;
}): BracketCreateMatrixRow[] {
  return [...input.teams]
    .map((team) => {
      const ranking = input.rankings.find((r) => r.team_id === team.id);
      const doubleSeedingRanking = input.doubleSeedingRankings.find(
        (r) => r.team_id === team.id,
      );
      const assigned = input.assigned.find((a) => a.team_id === team.id);
      const isSelected = input.selectedTeamIds.has(team.id);
      const hasOverlap = isSelected && !!assigned;
      return {
        team,
        ranking,
        doubleSeedingRanking,
        assigned,
        hasOverlap,
      };
    })
    .sort((a, b) => compareCreateMatrixRows(a, b, input.doubleSeedingEnabled));
}
