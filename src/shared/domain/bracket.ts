/**
 * Canonical bracket-related enum values.
 *
 * Mirrors the SQL CHECK constraints on `brackets.status`,
 * `bracket_games.status`, and `bracket_games.bracket_side`
 * (see `src/server/database/init.ts`).
 */

// ---------------------------------------------------------------------------
// brackets.status
// ---------------------------------------------------------------------------

export const BRACKET_STATUSES = ['setup', 'in_progress', 'completed'] as const;

export type BracketStatus = (typeof BRACKET_STATUSES)[number];

const BRACKET_STATUS_SET = new Set<string>(BRACKET_STATUSES);

export function isValidBracketStatus(value: unknown): value is BracketStatus {
  return typeof value === 'string' && BRACKET_STATUS_SET.has(value);
}

export const BRACKET_STATUS_LABELS: Record<BracketStatus, string> = {
  setup: 'Setup',
  in_progress: 'In Progress',
  completed: 'Completed',
};

// ---------------------------------------------------------------------------
// bracket_games.status
// ---------------------------------------------------------------------------

export const GAME_STATUSES = [
  'pending',
  'ready',
  'in_progress',
  'completed',
  'bye',
] as const;

export type GameStatus = (typeof GAME_STATUSES)[number];

const GAME_STATUS_SET = new Set<string>(GAME_STATUSES);

export function isValidGameStatus(value: unknown): value is GameStatus {
  return typeof value === 'string' && GAME_STATUS_SET.has(value);
}

export const GAME_STATUS_LABELS: Record<GameStatus, string> = {
  pending: 'Pending',
  ready: 'Ready',
  in_progress: 'In Progress',
  completed: 'Completed',
  bye: 'Bye',
};

/** Compact labels used by the bracket-like view. */
export const GAME_STATUS_DISPLAY_LABELS: Record<GameStatus, string> = {
  pending: 'Pending',
  ready: 'Ready',
  in_progress: 'Live',
  completed: 'Final',
  bye: 'Bye',
};

// ---------------------------------------------------------------------------
// bracket_games.bracket_side
// ---------------------------------------------------------------------------

export const BRACKET_SIDES = ['winners', 'losers', 'finals'] as const;

export type BracketSide = (typeof BRACKET_SIDES)[number];

const BRACKET_SIDE_SET = new Set<string>(BRACKET_SIDES);

export function isValidBracketSide(value: unknown): value is BracketSide {
  return typeof value === 'string' && BRACKET_SIDE_SET.has(value);
}

export const BRACKET_SIDE_LABELS: Record<BracketSide, string> = {
  winners: 'Winners Bracket',
  losers: 'Redemption Bracket',
  finals: 'Finals',
};
