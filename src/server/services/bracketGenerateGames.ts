import type { Database } from '../database/connection';
import type { GenerateGamesResult } from '../../shared/brackets';
import { ensureBracketTemplatesSeeded } from './bracketTemplates';
import { resolveBracketByes } from './bracketByeResolver';
import { markQueueDirty } from './queueVersion';
import { serviceFail, serviceOk, type ServiceResult } from './serviceResult';

interface TemplateRow {
  game_number: number;
  play_order: number | null;
  round_name: string | null;
  round_number: number | null;
  bracket_side: string | null;
  team1_source: string;
  team2_source: string;
  winner_advances_to: number | null;
  loser_advances_to: number | null;
  winner_slot: string | null;
  loser_slot: string | null;
}

interface EntryRow {
  seed_position: number;
  team_id: number | null;
  is_bye: boolean | number;
}

/**
 * Materialize `bracket_games` from templates for a bracket size.
 * Used by create-with-teams and POST /:id/games/generate.
 */
export async function materializeBracketGames(
  db: Database,
  bracketId: number,
  bracketSize: number,
  options: { replaceExisting?: boolean } = {},
): Promise<ServiceResult<GenerateGamesResult>> {
  await ensureBracketTemplatesSeeded(db, bracketSize);

  const templates = await db.all<TemplateRow>(
    'SELECT * FROM bracket_templates WHERE bracket_size = ? ORDER BY game_number ASC',
    [bracketSize],
  );

  if (templates.length === 0) {
    return serviceFail(
      400,
      `No bracket templates found for size ${bracketSize}`,
    );
  }

  const entries = await db.all<EntryRow>(
    'SELECT * FROM bracket_entries WHERE bracket_id = ? ORDER BY seed_position ASC',
    [bracketId],
  );

  const entriesBySeed = new Map<
    number,
    { team_id: number | null; is_bye: boolean }
  >();
  for (const entry of entries) {
    entriesBySeed.set(entry.seed_position, {
      team_id: entry.team_id,
      is_bye: !!entry.is_bye,
    });
  }

  if (options.replaceExisting) {
    await db.run('DELETE FROM bracket_games WHERE bracket_id = ?', [bracketId]);
  }

  const gameIdByNumber = new Map<number, number>();

  for (const template of templates) {
    const result = await db.run(
      `INSERT INTO bracket_games (
            bracket_id, game_number, play_order, round_name, round_number, bracket_side,
            team1_source, team2_source, status, winner_slot, loser_slot
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?) RETURNING id`,
      [
        bracketId,
        template.game_number,
        template.play_order,
        template.round_name,
        template.round_number,
        template.bracket_side,
        template.team1_source,
        template.team2_source,
        template.winner_slot,
        template.loser_slot,
      ],
    );
    gameIdByNumber.set(template.game_number, result.lastID as number);
  }

  for (const template of templates) {
    const gameId = gameIdByNumber.get(template.game_number);
    if (!gameId) continue;

    const winnerAdvancesToId = template.winner_advances_to
      ? gameIdByNumber.get(template.winner_advances_to)
      : null;
    const loserAdvancesToId = template.loser_advances_to
      ? gameIdByNumber.get(template.loser_advances_to)
      : null;

    let team1Id: number | null = null;
    let team2Id: number | null = null;
    let status = 'pending';

    if (template.team1_source.startsWith('seed:')) {
      const seedNum = parseInt(template.team1_source.split(':')[1], 10);
      const entry = entriesBySeed.get(seedNum);
      if (entry) {
        team1Id = entry.team_id;
      }
    }

    if (template.team2_source.startsWith('seed:')) {
      const seedNum = parseInt(template.team2_source.split(':')[1], 10);
      const entry = entriesBySeed.get(seedNum);
      if (entry) {
        team2Id = entry.team_id;
      }
    }

    const team1Entry = template.team1_source.startsWith('seed:')
      ? entriesBySeed.get(parseInt(template.team1_source.split(':')[1], 10))
      : null;
    const team2Entry = template.team2_source.startsWith('seed:')
      ? entriesBySeed.get(parseInt(template.team2_source.split(':')[1], 10))
      : null;

    let winnerId: number | null = null;
    if (team1Entry?.is_bye && team2Id) {
      winnerId = team2Id;
      status = 'bye';
    } else if (team2Entry?.is_bye && team1Id) {
      winnerId = team1Id;
      status = 'bye';
    } else if (team1Id && team2Id) {
      status = 'ready';
    }

    await db.run(
      `UPDATE bracket_games SET
            winner_advances_to_id = ?,
            loser_advances_to_id = ?,
            team1_id = ?,
            team2_id = ?,
            winner_id = ?,
            status = ?
          WHERE id = ?`,
      [
        winnerAdvancesToId,
        loserAdvancesToId,
        team1Id,
        team2Id,
        winnerId,
        status,
        gameId,
      ],
    );

    if (winnerId && winnerAdvancesToId && template.winner_slot) {
      const column = template.winner_slot === 'team1' ? 'team1_id' : 'team2_id';
      await db.run(`UPDATE bracket_games SET ${column} = ? WHERE id = ?`, [
        winnerId,
        winnerAdvancesToId,
      ]);
    }
  }

  await db.run(
    `UPDATE bracket_games SET status = 'ready'
         WHERE bracket_id = ? AND status = 'pending'
         AND team1_id IS NOT NULL AND team2_id IS NOT NULL`,
    [bracketId],
  );

  const byeResolution = await resolveBracketByes(db, bracketId);

  return serviceOk({
    message: 'Games generated successfully',
    gamesCreated: templates.length,
    byeResolution,
  });
}

export async function generateBracketGames(
  db: Database,
  bracketId: number,
  force: boolean,
): Promise<ServiceResult<GenerateGamesResult, { gamesCount?: number }>> {
  const bracket = await db.get<{
    id: number;
    event_id: number;
    bracket_size: number;
  }>('SELECT * FROM brackets WHERE id = ?', [bracketId]);

  if (!bracket) {
    return serviceFail(404, 'Bracket not found');
  }

  const existingGames = await db.all<{ id: number }>(
    'SELECT id FROM bracket_games WHERE bracket_id = ?',
    [bracketId],
  );

  if (existingGames.length > 0 && !force) {
    return serviceFail(
      409,
      'Bracket already has games. Use ?force=true to replace.',
      { gamesCount: existingGames.length },
    );
  }

  const result = await materializeBracketGames(
    db,
    bracketId,
    bracket.bracket_size,
    { replaceExisting: existingGames.length > 0 },
  );
  if (!result.ok) {
    return serviceFail(result.status, result.error);
  }

  await markQueueDirty(db, bracket.event_id);
  return result;
}
