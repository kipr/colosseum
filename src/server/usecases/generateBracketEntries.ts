import type { Database } from '../database/connection';
import { recalculateSeedingRankings } from '../services/seedingRankings';

export interface GenerateBracketEntriesParams {
  db: Database;
  bracketId: string | number;
  force: boolean;
}

interface GenerateSuccess {
  ok: true;
  message: string;
  entriesCreated: number;
  byeCount: number;
  totalEntries: number;
  actualTeamCount: number;
}

export type GenerateBracketEntriesResult =
  | GenerateSuccess
  | {
      ok: false;
      status: 400 | 404 | 409;
      error: string;
      entriesCount?: number;
    };

/** Generate bracket entries from the current seeding ranking snapshot. */
export async function generateBracketEntries(
  params: GenerateBracketEntriesParams,
): Promise<GenerateBracketEntriesResult> {
  const { db, bracketId, force } = params;

  const bracket = await db.get<{
    id: number;
    bracket_size: number;
    event_id: number;
  }>('SELECT * FROM brackets WHERE id = ?', [bracketId]);
  if (!bracket) {
    return { ok: false, status: 404, error: 'Bracket not found' };
  }

  const existingEntries = await db.all<{ id: number }>(
    'SELECT id FROM bracket_entries WHERE bracket_id = ?',
    [bracketId],
  );

  if (existingEntries.length > 0 && !force) {
    return {
      ok: false,
      status: 409,
      error: 'Bracket already has entries. Use ?force=true to replace.',
      entriesCount: existingEntries.length,
    };
  }

  const recalcResult = await recalculateSeedingRankings(bracket.event_id);
  console.log(
    `Recalculated rankings for event ${bracket.event_id}: ${recalcResult.teamsRanked} ranked, ${recalcResult.teamsUnranked} unranked`,
  );

  const rankedTeams = await db.all<{ team_id: number }>(
    `SELECT sr.team_id, sr.seed_rank, t.team_number, t.team_name, t.display_name
     FROM seeding_rankings sr
     JOIN teams t ON sr.team_id = t.id
     WHERE t.event_id = ? AND sr.seed_rank IS NOT NULL
     ORDER BY sr.seed_rank ASC`,
    [bracket.event_id],
  );

  if (rankedTeams.length === 0) {
    return {
      ok: false,
      status: 400,
      error: 'No ranked teams found. Calculate seeding rankings first.',
    };
  }

  const bracketSize = bracket.bracket_size;
  const teamCount = Math.min(rankedTeams.length, bracketSize);

  if (existingEntries.length > 0) {
    await db.run('DELETE FROM bracket_entries WHERE bracket_id = ?', [
      bracketId,
    ]);
  }

  let entriesCreated = 0;
  let byeCount = 0;
  for (let seedPosition = 1; seedPosition <= bracketSize; seedPosition++) {
    const team = rankedTeams[seedPosition - 1];
    if (team && seedPosition <= teamCount) {
      await db.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
         VALUES (?, ?, ?, 0)`,
        [bracketId, team.team_id, seedPosition],
      );
      entriesCreated++;
    } else {
      await db.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
         VALUES (?, NULL, ?, 1)`,
        [bracketId, seedPosition],
      );
      byeCount++;
    }
  }

  await db.run('UPDATE brackets SET actual_team_count = ? WHERE id = ?', [
    teamCount,
    bracketId,
  ]);

  return {
    ok: true,
    message: 'Entries generated successfully',
    entriesCreated,
    byeCount,
    totalEntries: entriesCreated + byeCount,
    actualTeamCount: teamCount,
  };
}
