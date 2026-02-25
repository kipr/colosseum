/**
 * Service for recalculating seeding rankings.
 * Can be called from seeding routes or bracket generation.
 */

import { getDatabase } from '../database/connection';

interface RankingData {
  teamId: number;
  seedAverage: number | null;
  tiebreaker: number | null;
}

/**
 * Recalculate seeding rankings for an event.
 * Algorithm: Average of top 2 of 3 scores, with tiebreaker.
 *
 * @param eventId - The event to recalculate rankings for
 * @returns Object with recalculated rankings count
 */
export async function recalculateSeedingRankings(
  eventId: number,
): Promise<{ teamsRanked: number; teamsUnranked: number }> {
  const db = await getDatabase();

  // Get all teams for this event
  const teams = await db.all('SELECT id FROM teams WHERE event_id = ?', [
    eventId,
  ]);

  if (teams.length === 0) {
    return { teamsRanked: 0, teamsUnranked: 0 };
  }

  // For each team, calculate their ranking based on seeding scores
  const rankings: RankingData[] = [];

  for (const team of teams) {
    const scores = await db.all(
      'SELECT score FROM seeding_scores WHERE team_id = ? AND score IS NOT NULL ORDER BY score DESC',
      [team.id],
    );

    let seedAverage: number | null = null;
    let tiebreaker: number | null = null;

    if (scores.length >= 2) {
      // Average of top 2 scores
      seedAverage = (scores[0].score + scores[1].score) / 2;
      // Tiebreaker: 3rd score if available, else sum of all
      tiebreaker =
        scores.length >= 3
          ? scores[2].score
          : scores.reduce((sum, s) => sum + s.score, 0);
    } else if (scores.length === 1) {
      seedAverage = scores[0].score;
      tiebreaker = scores[0].score;
    }

    rankings.push({ teamId: team.id, seedAverage, tiebreaker });
  }

  // Sort by seed_average DESC, then tiebreaker DESC
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
  const rankedTeams = rankings.filter((r) => r.seedAverage !== null);
  const n = rankedTeams.length;

  // Update rankings in database using a single transaction
  await db.transaction(async (tx) => {
    for (let i = 0; i < rankings.length; i++) {
      const r = rankings[i];
      const seedRank = r.seedAverage !== null ? i + 1 : null;

      // Calculate seed score using official formula
      let rawSeedScore: number | null = null;
      if (r.seedAverage !== null && seedRank !== null && n > 0) {
        const rankComponent = (3 / 4) * ((n - seedRank + 1) / n);
        const scoreComponent = (1 / 4) * (r.seedAverage / maxAverage);
        rawSeedScore = rankComponent + scoreComponent;
      }

      await tx.run(
        `INSERT INTO seeding_rankings (team_id, seed_average, seed_rank, raw_seed_score, tiebreaker_value)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(team_id) DO UPDATE SET
           seed_average = excluded.seed_average,
           seed_rank = excluded.seed_rank,
           raw_seed_score = excluded.raw_seed_score,
           tiebreaker_value = excluded.tiebreaker_value`,
        [r.teamId, r.seedAverage, seedRank, rawSeedScore, r.tiebreaker],
      );
    }
  });

  const teamsRanked = rankings.filter((r) => r.seedAverage !== null).length;
  const teamsUnranked = rankings.filter((r) => r.seedAverage === null).length;

  return { teamsRanked, teamsUnranked };
}
