/**
 * Shared read queries for bracket games and ranked bracket entries.
 *
 * Callers own authentication, release/visibility checks, ranking
 * recalculation, and which fields reach the response; these functions only
 * read what is persisted.
 */

import type { Database } from '../database/connection';
import {
  BRACKET_OVERALL_TOTAL_SQL,
  BRACKET_OVERALL_JOINS_SQL,
} from './overallScores';

export interface BracketRankingEntryRow {
  id: number;
  bracket_id: number;
  team_id: number | null;
  seed_position: number;
  initial_slot: number | null;
  is_bye: boolean;
  final_rank: number | null;
  bracket_raw_score: number | null;
  weighted_bracket_raw_score: number | null;
  doc_score: number;
  raw_seed_score: number;
  raw_double_seed_score: number;
  total: number;
  team_number: number | null;
  team_name: string | null;
  display_name: string | null;
}

export interface BracketGameWithTeamsRow {
  id: number;
  bracket_id: number;
  game_number: number;
  play_order: number | null;
  round_name: string | null;
  round_number: number | null;
  bracket_side: string | null;
  team1_id: number | null;
  team2_id: number | null;
  team1_source: string | null;
  team2_source: string | null;
  status: string;
  winner_id: number | null;
  loser_id: number | null;
  winner_advances_to_id: number | null;
  loser_advances_to_id: number | null;
  winner_slot: string | null;
  loser_slot: string | null;
  team1_score: number | null;
  team2_score: number | null;
  result_type: string;
  disqualified_team_id: number | null;
  score_submission_id: number | null;
  scheduled_time: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  team1_number: number | null;
  team1_name: string | null;
  team1_display: string | null;
  team2_number: number | null;
  team2_name: string | null;
  team2_display: string | null;
  winner_number: number | null;
  winner_name: string | null;
  winner_display: string | null;
}

/**
 * Games in a bracket with team number/name/display name joined for team1,
 * team2 and the winner, ordered by game number.
 *
 * Accepts the raw route param so Postgres rejects non-integer ids (`1e1`,
 * `0x10`) instead of JavaScript coercing them to another bracket.
 */
export async function listBracketGamesWithTeams(
  db: Database,
  bracketId: number | string,
): Promise<BracketGameWithTeamsRow[]> {
  return db.all<BracketGameWithTeamsRow>(
    `SELECT bg.*,
            t1.team_number as team1_number, t1.team_name as team1_name, t1.display_name as team1_display,
            t2.team_number as team2_number, t2.team_name as team2_name, t2.display_name as team2_display,
            w.team_number as winner_number, w.team_name as winner_name, w.display_name as winner_display
     FROM bracket_games bg
     LEFT JOIN teams t1 ON bg.team1_id = t1.id
     LEFT JOIN teams t2 ON bg.team2_id = t2.id
     LEFT JOIN teams w ON bg.winner_id = w.id
     WHERE bg.bracket_id = ?
     ORDER BY bg.game_number ASC`,
    [bracketId],
  );
}

/**
 * Every entry in a bracket (byes included) with its persisted final rank,
 * bracket scores, overall-total components and team fields, ordered by final
 * rank (unranked last) then seed position.
 */
export async function listBracketRankingEntries(
  db: Database,
  eventId: number,
  bracketId: number,
): Promise<BracketRankingEntryRow[]> {
  return db.all<BracketRankingEntryRow>(
    `SELECT be.id, be.bracket_id, be.team_id, be.seed_position, be.initial_slot, be.is_bye,
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
