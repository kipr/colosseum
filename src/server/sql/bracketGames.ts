import { Database } from '../database/connection';

/**
 * Shared `SELECT` projections and helpers for bracket-games queries that were
 * duplicated across `routes/brackets.ts`, `routes/scores.ts`, and
 * `services/scoreAccept.ts`.
 *
 * The constants here are SQL string fragments only — callers are responsible
 * for the surrounding `FROM` / `WHERE` / `ORDER BY` clauses since those vary
 * by use case (some need `bracket_id`, some need `event_id`, some need both).
 */

/** Column list that joins teams onto bracket_games (team1, team2, winner). */
export const BRACKET_GAME_TEAM_COLUMNS = `
  bg.team1_id,
  t1.team_number AS team1_number,
  t1.team_name AS team1_name,
  t1.display_name AS team1_display,
  bg.team2_id,
  t2.team_number AS team2_number,
  t2.team_name AS team2_name,
  t2.display_name AS team2_display,
  w.team_number AS winner_number,
  w.team_name AS winner_name,
  w.display_name AS winner_display
`.trim();

/** Standard JOIN clauses to attach team1/team2/winner to a bracket_games row. */
export const BRACKET_GAME_TEAM_JOINS = `
  LEFT JOIN teams t1 ON bg.team1_id = t1.id
  LEFT JOIN teams t2 ON bg.team2_id = t2.id
  LEFT JOIN teams w ON bg.winner_id = w.id
`.trim();

/**
 * Full `SELECT` for a bracket_games row including all wrapping team columns.
 * Use this when you want the same shape that the public bracket endpoint
 * returns. Caller appends `WHERE` and `ORDER BY`.
 *
 * Example:
 *   SELECT bg.*, ... FROM bracket_games bg LEFT JOIN teams ... WHERE bg.id = ?
 */
export const BRACKET_GAME_SELECT = `
  SELECT bg.*,
    t1.team_number as team1_number, t1.team_name as team1_name, t1.display_name as team1_display,
    t2.team_number as team2_number, t2.team_name as team2_name, t2.display_name as team2_display,
    w.team_number as winner_number, w.team_name as winner_name, w.display_name as winner_display
  FROM bracket_games bg
  ${BRACKET_GAME_TEAM_JOINS}
`.trim();

export interface BracketEntryRow {
  team_id: number | null;
  is_bye: boolean;
}

export interface BracketTemplateRow {
  game_number: number;
  round_name: string;
  round_number: number;
  bracket_side: string | null;
  team1_source: string;
  team2_source: string;
  winner_slot: string | null;
  loser_slot: string | null;
  winner_advances_to: number | null;
  loser_advances_to: number | null;
}

/**
 * Parse a `seed:N` source string and return the seed number, or `null` if the
 * source is not seed-based.
 */
function parseSeedSource(source: string | null | undefined): number | null {
  if (!source) return null;
  if (!source.startsWith('seed:')) return null;
  const parsed = parseInt(source.split(':')[1], 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface AssignedTemplateGame {
  team1Id: number | null;
  team2Id: number | null;
  status: 'pending' | 'ready' | 'bye';
  winnerId: number | null;
  team1Entry: BracketEntryRow | null;
  team2Entry: BracketEntryRow | null;
}

/**
 * Resolve a single template's seed-based team1/team2 references against a
 * map of seed → entry, and decide whether it is `pending`, `ready`, or
 * already a `bye` (with auto-advanced winner).
 *
 * This was previously duplicated as a ~70-line block in both `POST /brackets`
 * (creation) and `POST /brackets/:id/games/generate` (regeneration).
 */
export function assignTemplateGameTeams(
  template: BracketTemplateRow,
  entriesBySeed: Map<number, BracketEntryRow>,
): AssignedTemplateGame {
  const team1Seed = parseSeedSource(template.team1_source);
  const team2Seed = parseSeedSource(template.team2_source);
  const team1Entry =
    team1Seed !== null ? (entriesBySeed.get(team1Seed) ?? null) : null;
  const team2Entry =
    team2Seed !== null ? (entriesBySeed.get(team2Seed) ?? null) : null;

  const team1Id = team1Entry?.team_id ?? null;
  const team2Id = team2Entry?.team_id ?? null;

  let status: 'pending' | 'ready' | 'bye' = 'pending';
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

  return { team1Id, team2Id, status, winnerId, team1Entry, team2Entry };
}

/**
 * Insert one bracket_games row per template and return a map of
 * `template.game_number → inserted bracket_games.id`.
 */
export async function insertTemplateGames(
  db: Database,
  bracketId: number,
  templates: BracketTemplateRow[],
): Promise<Map<number, number>> {
  const gameIdByNumber = new Map<number, number>();
  for (const template of templates) {
    const result = await db.run(
      `INSERT INTO bracket_games (
        bracket_id, game_number, round_name, round_number, bracket_side,
        team1_source, team2_source, status, winner_slot, loser_slot
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [
        bracketId,
        template.game_number,
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
  return gameIdByNumber;
}

/**
 * Apply seed-based team assignments and bye auto-advancement for every
 * template in a bracket. Mirrors the "second pass" loop that previously
 * lived in both `POST /brackets` and `POST /brackets/:id/games/generate`.
 */
export async function applyTemplateAssignments(
  db: Database,
  templates: BracketTemplateRow[],
  gameIdByNumber: Map<number, number>,
  entriesBySeed: Map<number, BracketEntryRow>,
): Promise<void> {
  for (const template of templates) {
    const gameId = gameIdByNumber.get(template.game_number);
    if (!gameId) continue;

    const winnerAdvancesToId = template.winner_advances_to
      ? (gameIdByNumber.get(template.winner_advances_to) ?? null)
      : null;
    const loserAdvancesToId = template.loser_advances_to
      ? (gameIdByNumber.get(template.loser_advances_to) ?? null)
      : null;

    const { team1Id, team2Id, status, winnerId } = assignTemplateGameTeams(
      template,
      entriesBySeed,
    );

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
}

/**
 * Load bracket entries keyed by seed_position. Used by both the create and
 * regenerate paths to feed `applyTemplateAssignments`.
 */
export async function loadEntriesBySeed(
  db: Database,
  bracketId: number,
): Promise<Map<number, BracketEntryRow>> {
  const entries = await db.all<{
    seed_position: number;
    team_id: number | null;
    is_bye: number | boolean;
  }>(
    'SELECT * FROM bracket_entries WHERE bracket_id = ? ORDER BY seed_position ASC',
    [bracketId],
  );
  const entriesBySeed = new Map<number, BracketEntryRow>();
  for (const entry of entries) {
    entriesBySeed.set(entry.seed_position, {
      team_id: entry.team_id,
      is_bye: !!entry.is_bye,
    });
  }
  return entriesBySeed;
}

/**
 * After all per-template UPDATEs, mark any remaining games as 'ready' if they
 * have both teams populated. Same SQL as the previous inline statements.
 */
export async function markReadyGames(
  db: Database,
  bracketId: number,
): Promise<void> {
  await db.run(
    `UPDATE bracket_games SET status = 'ready'
     WHERE bracket_id = ? AND status = 'pending'
     AND team1_id IS NOT NULL AND team2_id IS NOT NULL`,
    [bracketId],
  );
}
