import type { SeedingTableRow, Team } from './types';

export interface SeedingTableScoreInput {
  team_id: number;
  round_number: number;
  score: number | null;
}

export interface SeedingTableRankingInput {
  team_id: number;
  seed_rank: number | null;
  seed_average: number | null;
}

export function buildSeedingTableRows<
  TScore extends SeedingTableScoreInput,
  TRanking extends SeedingTableRankingInput,
>(
  teams: Team[],
  scores: TScore[],
  rankings: TRanking[],
  effectiveRounds: number,
  getRawScore: (ranking: TRanking) => number | null,
): SeedingTableRow[] {
  const scoreMap = new Map<string, TScore>();
  for (const score of scores) {
    scoreMap.set(`${score.team_id}:${score.round_number}`, score);
  }

  const rankingMap = new Map<number, TRanking>();
  for (const ranking of rankings) {
    rankingMap.set(ranking.team_id, ranking);
  }

  return teams.map((team) => {
    const teamScores = new Map<number, { score: number | null } | null>();
    for (let round = 1; round <= effectiveRounds; round++) {
      const score = scoreMap.get(`${team.id}:${round}`);
      teamScores.set(round, score ? { score: score.score } : null);
    }
    const ranking = rankingMap.get(team.id);
    return {
      team,
      scores: teamScores,
      ranking: ranking
        ? {
            seed_rank: ranking.seed_rank,
            seed_average: ranking.seed_average,
            raw_score: getRawScore(ranking),
          }
        : null,
    };
  });
}
