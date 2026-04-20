import type { Database } from '../database/connection';
import { ensureBracketTemplatesSeeded } from '../services/bracketTemplates';
import { resolveBracketByes } from '../services/bracketByeResolver';
import {
  applyTemplateAssignments,
  insertTemplateGames,
  loadEntriesBySeed,
  markReadyGames,
  type BracketTemplateRow,
} from '../sql/bracketGames';

export interface GenerateBracketGamesParams {
  db: Database;
  bracketId: string | number;
  force: boolean;
}

interface GenerateSuccess {
  ok: true;
  message: string;
  gamesCreated: number;
  byeResolution: unknown;
}

export type GenerateBracketGamesResult =
  | GenerateSuccess
  | { ok: false; status: 400 | 404 | 409; error: string; gamesCount?: number };

/**
 * Generate bracket_games rows from the canonical bracket_templates for this
 * bracket size, populate seed-based assignments, and resolve any bye chains.
 *
 * The heavy lifting (seed resolution, ready/bye marking) lives in the shared
 * `sql/bracketGames` helpers — this use case is mostly orchestration and
 * preconditions.
 */
export async function generateBracketGames(
  params: GenerateBracketGamesParams,
): Promise<GenerateBracketGamesResult> {
  const { db, bracketId, force } = params;

  const bracket = await db.get<{ id: number; bracket_size: number }>(
    'SELECT * FROM brackets WHERE id = ?',
    [bracketId],
  );
  if (!bracket) {
    return { ok: false, status: 404, error: 'Bracket not found' };
  }

  const existingGames = await db.all<{ id: number }>(
    'SELECT id FROM bracket_games WHERE bracket_id = ?',
    [bracketId],
  );
  if (existingGames.length > 0 && !force) {
    return {
      ok: false,
      status: 409,
      error: 'Bracket already has games. Use ?force=true to replace.',
      gamesCount: existingGames.length,
    };
  }

  await ensureBracketTemplatesSeeded(db, bracket.bracket_size);
  const templates = await db.all<BracketTemplateRow>(
    'SELECT * FROM bracket_templates WHERE bracket_size = ? ORDER BY game_number ASC',
    [bracket.bracket_size],
  );
  if (templates.length === 0) {
    return {
      ok: false,
      status: 400,
      error: `No bracket templates found for size ${bracket.bracket_size}`,
    };
  }

  const numericId =
    typeof bracketId === 'number' ? bracketId : parseInt(bracketId, 10);

  const entriesBySeed = await loadEntriesBySeed(db, numericId);

  if (existingGames.length > 0) {
    await db.run('DELETE FROM bracket_games WHERE bracket_id = ?', [bracketId]);
  }

  const gameIdByNumber = await insertTemplateGames(db, numericId, templates);
  await applyTemplateAssignments(db, templates, gameIdByNumber, entriesBySeed);
  await markReadyGames(db, numericId);
  const byeResolution = await resolveBracketByes(db, numericId);

  return {
    ok: true,
    message: 'Games generated successfully',
    gamesCreated: templates.length,
    byeResolution,
  };
}
