/**
 * Service for recalculating double-seeding rankings.
 *
 * Raw double seed score: (2/3) * ((n - rank + 1) / n) + (1/3) * (avg / max)
 * - n    = number of teams at the event
 * - rank = team's ordinal double-seeding ranking
 * - avg  = team's average double-seeding score (no rounds dropped; missing
 *          scores are ignored, zeros count as zeros)
 * - max  = max tournament double-seeding average
 * Internal tiebreaker for tied averages: the team's lowest score (higher wins).
 */

import { getDatabase } from '../database/connection';

interface RankingData {
  teamId: number;
  seedAverage: number | null;
  tiebreaker: number | null;
}

export async function recalculateDoubleSeedingRankings(
  eventId: number,
): Promise<{ teamsRanked: number; teamsUnranked: number }> {
  const db = await getDatabase();

  const teams = await db.all<{ id: number }>(
    'SELECT id FROM teams WHERE event_id = ?',
    [eventId],
  );

  if (teams.length === 0) {
    return { teamsRanked: 0, teamsUnranked: 0 };
  }

  const scoreRows = await db.all<{ team_id: number; score: number }>(
    `SELECT team_id, score FROM double_seeding_scores
     WHERE event_id = ? AND score IS NOT NULL`,
    [eventId],
  );
  const scoresByTeam = new Map<number, number[]>();
  for (const row of scoreRows) {
    const list = scoresByTeam.get(row.team_id) ?? [];
    list.push(row.score);
    scoresByTeam.set(row.team_id, list);
  }

  const rankings: RankingData[] = teams.map((team) => {
    const scores = scoresByTeam.get(team.id) ?? [];
    if (scores.length === 0) {
      return { teamId: team.id, seedAverage: null, tiebreaker: null };
    }
    const seedAverage = scores.reduce((sum, s) => sum + s, 0) / scores.length;
    const tiebreaker = Math.min(...scores);
    return { teamId: team.id, seedAverage, tiebreaker };
  });

  // Sort by average DESC, then lowest-score tiebreaker DESC; unranked last.
  rankings.sort((a, b) => {
    if (a.seedAverage === null && b.seedAverage === null) return 0;
    if (a.seedAverage === null) return 1;
    if (b.seedAverage === null) return -1;
    if (a.seedAverage !== b.seedAverage) return b.seedAverage - a.seedAverage;
    if (a.tiebreaker === null && b.tiebreaker === null) return 0;
    if (a.tiebreaker === null) return 1;
    if (b.tiebreaker === null) return -1;
    return b.tiebreaker - a.tiebreaker;
  });

  const maxAverage =
    rankings.find((r) => r.seedAverage !== null)?.seedAverage || 1;
  const n = teams.length;

  await db.transaction(async (tx) => {
    for (let i = 0; i < rankings.length; i++) {
      const r = rankings[i];
      const seedRank = r.seedAverage !== null ? i + 1 : null;

      let rawScore: number | null = null;
      if (r.seedAverage !== null && seedRank !== null && n > 0) {
        const rankComponent = (2 / 3) * ((n - seedRank + 1) / n);
        const scoreComponent = (1 / 3) * (r.seedAverage / maxAverage);
        rawScore = rankComponent + scoreComponent;
      }

      await tx.run(
        `INSERT INTO double_seeding_rankings (team_id, seed_average, seed_rank, raw_double_seed_score, tiebreaker_value)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(team_id) DO UPDATE SET
           seed_average = excluded.seed_average,
           seed_rank = excluded.seed_rank,
           raw_double_seed_score = excluded.raw_double_seed_score,
           tiebreaker_value = excluded.tiebreaker_value`,
        [r.teamId, r.seedAverage, seedRank, rawScore, r.tiebreaker],
      );
    }
  });

  const teamsRanked = rankings.filter((r) => r.seedAverage !== null).length;
  const teamsUnranked = rankings.length - teamsRanked;

  return { teamsRanked, teamsUnranked };
}
