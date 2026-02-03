// Bracket-related types shared across components

export type BracketStatus = 'setup' | 'in_progress' | 'completed';
export type GameStatus =
  | 'pending'
  | 'ready'
  | 'in_progress'
  | 'completed'
  | 'bye';
export type BracketSide = 'winners' | 'losers' | 'finals';

export interface Bracket {
  id: number;
  event_id: number;
  name: string;
  bracket_size: number;
  actual_team_count: number | null;
  status: BracketStatus;
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
  // Joined team info
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
}

// Display label mappings for admin management view
export const STATUS_LABELS: Record<BracketStatus, string> = {
  setup: 'Setup',
  in_progress: 'In Progress',
  completed: 'Completed',
};

export const GAME_STATUS_LABELS: Record<GameStatus, string> = {
  pending: 'Pending',
  ready: 'Ready',
  in_progress: 'In Progress',
  completed: 'Completed',
  bye: 'Bye',
};

// Display label mappings for bracket-like view (more compact)
export const GAME_STATUS_DISPLAY_LABELS: Record<GameStatus, string> = {
  pending: 'Pending',
  ready: 'Ready',
  in_progress: 'Live',
  completed: 'Final',
  bye: 'Bye',
};

export const BRACKET_SIDE_LABELS: Record<BracketSide, string> = {
  winners: 'Winners Bracket',
  losers: 'Losers Bracket',
  finals: 'Finals',
};
