import type { Database } from '../database/connection';
import type { GenerateEntriesResult } from '../../shared/brackets';
import { recalculateSeedingRankings } from './seedingRankings';
import { serviceFail, serviceOk, type ServiceResult } from './serviceResult';

export async function generateBracketEntries(
  db: Database,
  bracketId: number,
  force: boolean,
): Promise<ServiceResult<GenerateEntriesResult, { entriesCount: number }>> {
  const bracket = await db.get<{
    id: number;
    event_id: number;
    bracket_size: number;
  }>('SELECT * FROM brackets WHERE id = ?', [bracketId]);

  if (!bracket) {
    return serviceFail(404, 'Bracket not found');
  }

  const existingEntries = await db.all<{ id: number }>(
    'SELECT id FROM bracket_entries WHERE bracket_id = ?',
    [bracketId],
  );

  if (existingEntries.length > 0 && !force) {
    return serviceFail(
      409,
      'Bracket already has entries. Use ?force=true to replace.',
      { entriesCount: existingEntries.length },
    );
  }

  const recalcResult = await recalculateSeedingRankings(bracket.event_id);
  console.log(
    `Recalculated rankings for event ${bracket.event_id}: ${recalcResult.teamsRanked} ranked, ${recalcResult.teamsUnranked} unranked`,
  );

  const rankedTeams = await db.all<{
    team_id: number;
    seed_rank: number | null;
    team_number: number;
    team_name: string;
    display_name: string | null;
  }>(
    `SELECT sr.team_id, sr.seed_rank, t.team_number, t.team_name, t.display_name
         FROM seeding_rankings sr
         JOIN teams t ON sr.team_id = t.id
         WHERE t.event_id = ? AND sr.seed_rank IS NOT NULL
         ORDER BY sr.seed_rank ASC`,
    [bracket.event_id],
  );

  if (rankedTeams.length === 0) {
    return serviceFail(
      400,
      'No ranked teams found. Calculate seeding rankings first.',
    );
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
             VALUES (?, ?, ?, ?) RETURNING id`,
        [bracketId, team.team_id, seedPosition, false],
      );
      entriesCreated++;
    } else {
      await db.run(
        `INSERT INTO bracket_entries (bracket_id, team_id, seed_position, is_bye)
             VALUES (?, NULL, ?, ?) RETURNING id`,
        [bracketId, seedPosition, true],
      );
      byeCount++;
    }
  }

  await db.run('UPDATE brackets SET actual_team_count = ? WHERE id = ?', [
    teamCount,
    bracketId,
  ]);

  return serviceOk({
    message: 'Entries generated successfully',
    entriesCreated,
    byeCount,
    totalEntries: entriesCreated + byeCount,
    actualTeamCount: teamCount,
  });
}
