import type { Database } from '../database/connection';

export interface ListSeedingScoresForTeamParams {
  db: Database;
  teamId: number | string;
}

export type ListSeedingScoresForTeamResult = {
  ok: true;
  scores: Record<string, unknown>[];
};

/** List all seeding scores for a team, ordered by round. */
export async function listSeedingScoresForTeam(
  params: ListSeedingScoresForTeamParams,
): Promise<ListSeedingScoresForTeamResult> {
  const { db, teamId } = params;
  const scores = await db.all(
    'SELECT * FROM seeding_scores WHERE team_id = ? ORDER BY round_number ASC',
    [teamId],
  );
  return { ok: true, scores };
}
