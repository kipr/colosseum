import type { BracketResultType } from './bracketResult';

export type BracketStatus = 'setup' | 'in_progress' | 'completed';
export type GameStatus =
  | 'pending'
  | 'ready'
  | 'in_progress'
  | 'completed'
  | 'bye';
export type BracketSide = 'winners' | 'losers' | 'finals';

export const BRACKET_SIZES = [4, 8, 16, 32, 64] as const;
export type BracketSize = (typeof BRACKET_SIZES)[number];

/** Smallest power-of-two bracket size that can hold `n` teams, clamped to 4–64. */
export function nextPowerOfTwo(n: number): number {
  if (n <= 0) return 4;
  const p = Math.pow(2, Math.ceil(Math.log2(n)));
  return Math.max(4, Math.min(64, p));
}

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
  raw_double_seed_score: number;
  total: number;
}

export interface BracketGame {
  id: number;
  bracket_id: number;
  game_number: number;
  play_order: number | null;
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
  result_type: BracketResultType;
  disqualified_team_id: number | null;
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

export interface AssignedTeam {
  team_id: number;
  team_number: number;
  team_name: string;
  bracket_id: number;
  bracket_name: string;
}

export interface TeamAssignmentConflict {
  team_id: number;
  team_number: number;
  team_name: string;
  bracket_id: number;
  bracket_name: string;
}

export interface BracketRankingsResponse {
  weight: number;
  entries: BracketEntryWithRank[];
}

export interface EventBracketGame {
  id: number;
  bracket_game_id: number;
  bracket_id: number;
  bracket_name: string;
  game_number: number;
  round_name: string | null;
  bracket_side: BracketSide | null;
  status: GameStatus;
  winner_id: number | null;
  result_type: BracketResultType;
  disqualified_team_id: number | null;
  queue_position: number | null;
  team1_id: number | null;
  team1_number?: number;
  team1_name?: string;
  team1_display?: string | null;
  team2_id: number | null;
  team2_number?: number;
  team2_name?: string;
  team2_display?: string | null;
  winner_number?: number;
  winner_name?: string;
  winner_display?: string | null;
}

export interface CreateBracketBody {
  event_id: number;
  name: string;
  bracket_size?: number;
  actual_team_count?: number | null;
  status?: BracketStatus;
  weight?: number;
  team_ids?: number[];
}

export interface PatchBracketBody {
  name?: string;
  bracket_size?: number;
  actual_team_count?: number | null;
  status?: BracketStatus;
  weight?: number;
}

export interface CreateEntryBody {
  team_id?: number | null;
  seed_position: number;
  initial_slot?: number | null;
  is_bye?: boolean;
}

export interface CreateGameBody {
  game_number: number;
  round_name?: string | null;
  round_number?: number | null;
  bracket_side?: BracketSide | null;
  team1_id?: number | null;
  team2_id?: number | null;
  team1_source?: string | null;
  team2_source?: string | null;
  status?: GameStatus;
  winner_advances_to_id?: number | null;
  loser_advances_to_id?: number | null;
  winner_slot?: string | null;
  loser_slot?: string | null;
  scheduled_time?: string | null;
}

export interface AdvanceWinnerBody {
  game_id: number;
  winner_id: number;
}

export interface CreateTemplateBody {
  bracket_size: number;
  game_number: number;
  play_order?: number | null;
  round_name: string;
  round_number: number;
  bracket_side: BracketSide;
  team1_source: string;
  team2_source: string;
  winner_advances_to?: number | null;
  loser_advances_to?: number | null;
  winner_slot?: string | null;
  loser_slot?: string | null;
  is_championship?: boolean;
  is_grand_final?: boolean;
  is_reset_game?: boolean;
}

export interface GenerateEntriesResult {
  message: string;
  entriesCreated: number;
  byeCount: number;
  totalEntries: number;
  actualTeamCount: number;
}

export interface GenerateGamesResult {
  message: string;
  gamesCreated: number;
  byeResolution: {
    byeGamesResolved: number;
    slotsFilled: number;
    readyGamesUpdated: number;
  };
}

export interface AdvancementSlotUpdate {
  gameId: number;
  slot: string;
  teamId: number;
}

export interface AdvanceExistingWinnerResult {
  message: string;
  updates: AdvancementSlotUpdate[];
  byeResolution: GenerateGamesResult['byeResolution'];
}

export interface AdvanceWinnerResult {
  message: string;
  winner_id: number;
  loser_id: number | null;
  updates: AdvancementSlotUpdate[];
  byeResolution: GenerateGamesResult['byeResolution'];
}
