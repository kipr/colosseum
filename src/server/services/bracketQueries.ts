import type { Database } from '../database/connection';
import type {
  AssignedTeam,
  Bracket,
  BracketEntry,
  BracketEntryWithRank,
  BracketGame,
} from '../../shared/brackets';
import {
  BRACKET_OVERALL_JOINS_SQL,
  BRACKET_OVERALL_TOTAL_SQL,
} from './overallScores';

export const BRACKET_GAMES_WITH_TEAMS_SQL = `SELECT bg.*,
              t1.team_number as team1_number, t1.team_name as team1_name, t1.display_name as team1_display,
              t2.team_number as team2_number, t2.team_name as team2_name, t2.display_name as team2_display,
              w.team_number as winner_number, w.team_name as winner_name, w.display_name as winner_display
       FROM bracket_games bg
       LEFT JOIN teams t1 ON bg.team1_id = t1.id
       LEFT JOIN teams t2 ON bg.team2_id = t2.id
       LEFT JOIN teams w ON bg.winner_id = w.id`;

export async function listBracketsForEvent(
  db: Database,
  eventId: string | number,
): Promise<Bracket[]> {
  return db.all<Bracket>(
    'SELECT * FROM brackets WHERE event_id = ? ORDER BY created_at ASC',
    [eventId],
  );
}

export async function listAssignedTeams(
  db: Database,
  eventId: string | number,
): Promise<AssignedTeam[]> {
  return db.all<AssignedTeam>(
    `SELECT be.team_id, t.team_number, t.team_name, b.id as bracket_id, b.name as bracket_name
         FROM bracket_entries be
         JOIN brackets b ON be.bracket_id = b.id
         JOIN teams t ON be.team_id = t.id
         WHERE b.event_id = ? AND be.team_id IS NOT NULL
         ORDER BY b.name ASC, be.seed_position ASC`,
    [eventId],
  );
}

export async function getBracketById(
  db: Database,
  id: string | number,
): Promise<Bracket | undefined> {
  return db.get<Bracket>('SELECT * FROM brackets WHERE id = ?', [id]);
}

export async function listPublicBracketEntries(
  db: Database,
  bracketId: string | number,
): Promise<BracketEntry[]> {
  return db.all<BracketEntry>(
    `SELECT be.id, be.bracket_id, be.team_id, be.seed_position, be.initial_slot, be.is_bye,
              t.team_number, t.team_name, t.display_name
       FROM bracket_entries be
       LEFT JOIN teams t ON be.team_id = t.id
       WHERE be.bracket_id = ?
       ORDER BY be.seed_position ASC`,
    [bracketId],
  );
}

export async function listBracketGamesWithTeams(
  db: Database,
  bracketId: string | number,
): Promise<BracketGame[]> {
  return db.all<BracketGame>(
    `${BRACKET_GAMES_WITH_TEAMS_SQL}
       WHERE bg.bracket_id = ?
       ORDER BY bg.game_number ASC`,
    [bracketId],
  );
}

export async function listRankedBracketEntries(
  db: Database,
  eventId: number,
  bracketId: string | number,
  options: { includeInitialSlot: boolean },
): Promise<BracketEntryWithRank[]> {
  const initialSlotSql = options.includeInitialSlot ? 'be.initial_slot, ' : '';
  return db.all<BracketEntryWithRank>(
    `SELECT be.id, be.bracket_id, be.team_id, be.seed_position, ${initialSlotSql}be.is_bye,
                be.final_rank, be.bracket_raw_score, be.weighted_bracket_raw_score,
                COALESCE(ds.overall_score, 0) AS doc_score,
                COALESCE(sr.raw_seed_score, 0) AS raw_seed_score,
                COALESCE(dsr.raw_double_seed_score, 0) AS raw_double_seed_score,
                ${BRACKET_OVERALL_TOTAL_SQL} AS total,
                t.team_number, t.team_name, t.display_name
         FROM bracket_entries be
         LEFT JOIN teams t ON be.team_id = t.id
         ${BRACKET_OVERALL_JOINS_SQL}
         WHERE be.bracket_id = ?
         ORDER BY COALESCE(be.final_rank, 9999) ASC, be.seed_position ASC`,
    [eventId, bracketId],
  );
}
