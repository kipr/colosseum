/**
 * Service for calculating final bracket rankings from double-elimination results.
 * Uses Botball rules: ties preserved for official display (1, 2, 3, 4, 5, 5, 7, 7...),
 * with seeding rank used internally for sort order only.
 */

import { getDatabase } from '../database/connection';

export interface CalculateBracketRankingsResult {
  teamsRanked: number;
}

/**
 * Calculate final bracket rankings for a completed double-elimination bracket.
 * Assigns ranks 1, 2, 3, 4, 5, 5, 7, 7, 9, 9, 9, 9... (ties preserved).
 * Teams tied in elimination round are ordered by seed_rank for display order.
 *
 * @param bracketId - The bracket to calculate rankings for
 * @returns Object with count of teams ranked
 */
export async function calculateBracketRankings(
  bracketId: number,
): Promise<CalculateBracketRankingsResult> {
  const db = await getDatabase();

  // 1. Determine 1st and 2nd from finals (highest game_number = decisive match)
  const finalsGames = await db.all<{
    game_number: number;
    winner_id: number | null;
    loser_id: number | null;
  }>(
    `SELECT game_number, winner_id, loser_id
     FROM bracket_games
     WHERE bracket_id = ? AND bracket_side = 'finals' AND status = 'completed'
     ORDER BY game_number DESC`,
    [bracketId],
  );

  if (finalsGames.length === 0) {
    throw new Error(
      'Cannot calculate rankings: no completed finals games found',
    );
  }

  const decisiveFinal = finalsGames[0];
  const rank1TeamId = decisiveFinal.winner_id;
  const rank2TeamId = decisiveFinal.loser_id;

  if (!rank1TeamId || !rank2TeamId) {
    throw new Error(
      'Cannot calculate rankings: final game missing winner or loser',
    );
  }

  // 2. Collect losers from losers bracket, grouped by round_number
  const loserRows = await db.all<{
    loser_id: number;
    round_number: number | null;
  }>(
    `SELECT loser_id, round_number
     FROM bracket_games
     WHERE bracket_id = ? AND bracket_side = 'losers' AND status = 'completed'
       AND loser_id IS NOT NULL`,
    [bracketId],
  );

  // 3. Group by round_number (use 0 for null rounds)
  const roundToTeams = new Map<number, number[]>();
  for (const row of loserRows) {
    const round = row.round_number ?? 0;
    const teams = roundToTeams.get(round) ?? [];
    teams.push(row.loser_id);
    roundToTeams.set(round, teams);
  }

  // 4. Get seeding ranks for tiebreaker (team_id -> seed_rank)
  const bracket = await db.get<{ event_id: number }>(
    'SELECT event_id FROM brackets WHERE id = ?',
    [bracketId],
  );
  if (!bracket) {
    throw new Error('Bracket not found');
  }

  const seedRanks = await db.all<{ team_id: number; seed_rank: number }>(
    `SELECT sr.team_id, sr.seed_rank
     FROM seeding_rankings sr
     JOIN teams t ON sr.team_id = t.id
     WHERE t.event_id = ? AND sr.seed_rank IS NOT NULL`,
    [bracket.event_id],
  );
  const teamToSeedRank = new Map(
    seedRanks.map((r) => [r.team_id, r.seed_rank]),
  );

  // 5. Sort rounds descending (highest round = eliminated latest = better rank)
  const sortedRounds = [...roundToTeams.keys()].sort((a, b) => b - a);

  // 6. Build ordered list: within each round, sort by seed_rank ASC (best seed first)
  const rankedTeams: { teamId: number; finalRank: number }[] = [
    { teamId: rank1TeamId, finalRank: 1 },
    { teamId: rank2TeamId, finalRank: 2 },
  ];

  let nextRank = 3;
  for (const round of sortedRounds) {
    const teamIds = roundToTeams.get(round)!;
    // Sort by seed_rank ASC; nulls last (treat as 999)
    teamIds.sort((a, b) => {
      const rankA = teamToSeedRank.get(a) ?? 999;
      const rankB = teamToSeedRank.get(b) ?? 999;
      return rankA - rankB;
    });
    const rankForRound = nextRank;
    for (const teamId of teamIds) {
      rankedTeams.push({ teamId, finalRank: rankForRound });
    }
    nextRank += teamIds.length;
  }

  // 7. Update bracket_entries
  const entries = await db.all<{ id: number; team_id: number | null }>(
    'SELECT id, team_id FROM bracket_entries WHERE bracket_id = ? AND is_bye = 0',
    [bracketId],
  );

  const n = entries.length;
  const teamToRank = new Map(rankedTeams.map((r) => [r.teamId, r.finalRank]));

  await db.transaction(async (tx) => {
    await tx.run(
      `UPDATE bracket_entries SET final_rank = NULL, bracket_raw_score = NULL WHERE bracket_id = ?`,
      [bracketId],
    );

    for (const entry of entries) {
      if (entry.team_id !== null) {
        const rank = teamToRank.get(entry.team_id);
        if (rank !== undefined) {
          const rawScore = n > 0 ? (n - rank + 1) / n : null;
          await tx.run(
            `UPDATE bracket_entries SET final_rank = ?, bracket_raw_score = ? WHERE id = ?`,
            [rank, rawScore, entry.id],
          );
        }
      }
    }
  });

  return { teamsRanked: rankedTeams.length };
}
