/**
 * Re-exports the canonical bracket enums + labels from the shared domain layer
 * and defines client-only DTO shapes (with joined team metadata) used by the
 * admin/spectator bracket views.
 */

export {
  BRACKET_STATUSES,
  BRACKET_STATUS_LABELS as STATUS_LABELS,
  isValidBracketStatus,
  GAME_STATUSES,
  GAME_STATUS_LABELS,
  GAME_STATUS_DISPLAY_LABELS,
  isValidGameStatus,
  BRACKET_SIDES,
  BRACKET_SIDE_LABELS,
  isValidBracketSide,
  type BracketStatus,
  type GameStatus,
  type BracketSide,
} from '@shared/domain/bracket';

import type {
  BracketStatus,
  GameStatus,
  BracketSide,
} from '@shared/domain/bracket';

export interface Bracket {
  id: number;
  event_id: number;
  name: string;
  bracket_size: number;
  actual_team_count: number | null;
  status: BracketStatus;
  weight: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface BracketEntry {
  id: number;
  bracket_id: number;
  team_id: number | null;
  seed_position: number;
  initial_slot: number | null;
  is_bye: boolean;
  team_number?: number;
  team_name?: string;
  display_name?: string | null;
}

export interface BracketEntryWithRank extends BracketEntry {
  final_rank: number | null;
  bracket_raw_score: number | null;
  weighted_bracket_raw_score: number | null;
  doc_score: number;
  raw_seed_score: number;
  total: number;
}

export interface BracketGame {
  id: number;
  bracket_id: number;
  game_number: number;
  round_name: string | null;
  round_number: number | null;
  bracket_side: BracketSide | null;
  team1_id: number | null;
  team2_id: number | null;
  team1_source: string | null;
  team2_source: string | null;
  status: GameStatus;
  winner_id: number | null;
  loser_id: number | null;
  winner_advances_to_id: number | null;
  loser_advances_to_id: number | null;
  winner_slot: string | null;
  loser_slot: string | null;
  team1_score: number | null;
  team2_score: number | null;
  scheduled_time: string | null;
  started_at: string | null;
  completed_at: string | null;
  team1_number?: number;
  team1_name?: string;
  team1_display?: string | null;
  team2_number?: number;
  team2_name?: string;
  team2_display?: string | null;
  winner_number?: number;
  winner_name?: string;
  winner_display?: string | null;
}

export interface BracketDetail extends Bracket {
  entries: BracketEntry[];
  games: BracketGame[];
  /** Populated only for authenticated admins via GET /:id/rankings */
  rankings?: BracketEntryWithRank[];
}
