/**
 * Canonical bracket / bracket-game domain enums, DTOs, and label maps.
 *
 * Used by the DB schema (CHECK constraints), bracket services on the server,
 * and bracket views on the client.
 */

export const BRACKET_STATUSES = ['setup', 'in_progress', 'completed'] as const;
export type BracketStatus = (typeof BRACKET_STATUSES)[number];

export const GAME_STATUSES = [
  'pending',
  'ready',
  'in_progress',
  'completed',
  'bye',
] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

export const BRACKET_SIDES = ['winners', 'losers', 'finals'] as const;
export type BracketSide = (typeof BRACKET_SIDES)[number];

const BRACKET_STATUS_SET: ReadonlySet<string> = new Set(BRACKET_STATUSES);
const GAME_STATUS_SET: ReadonlySet<string> = new Set(GAME_STATUSES);
const BRACKET_SIDE_SET: ReadonlySet<string> = new Set(BRACKET_SIDES);

export function isBracketStatus(value: unknown): value is BracketStatus {
  return typeof value === 'string' && BRACKET_STATUS_SET.has(value);
}

export function isGameStatus(value: unknown): value is GameStatus {
  return typeof value === 'string' && GAME_STATUS_SET.has(value);
}

export function isBracketSide(value: unknown): value is BracketSide {
  return typeof value === 'string' && BRACKET_SIDE_SET.has(value);
}

/** Display labels for bracket status (admin management view). */
export const BRACKET_STATUS_LABELS: Record<BracketStatus, string> = {
  setup: 'Setup',
  in_progress: 'In Progress',
  completed: 'Completed',
};

/** Display labels for bracket-game status (admin management view). */
export const GAME_STATUS_LABELS: Record<GameStatus, string> = {
  pending: 'Pending',
  ready: 'Ready',
  in_progress: 'In Progress',
  completed: 'Completed',
  bye: 'Bye',
};

/** Compact display labels for bracket-like / spectator views. */
export const GAME_STATUS_DISPLAY_LABELS: Record<GameStatus, string> = {
  pending: 'Pending',
  ready: 'Ready',
  in_progress: 'Live',
  completed: 'Final',
  bye: 'Bye',
};

export const BRACKET_SIDE_LABELS: Record<BracketSide, string> = {
  winners: 'Winners Bracket',
  losers: 'Redemption Bracket',
  finals: 'Finals',
};

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

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
  /** Populated only for authenticated admins via GET /:id/rankings */
  rankings?: BracketEntryWithRank[];
}
