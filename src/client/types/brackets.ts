export type {
  AdvanceExistingWinnerResult,
  AdvanceWinnerBody,
  AdvanceWinnerResult,
  AdvancementSlotUpdate,
  AssignedTeam,
  Bracket,
  BracketDetail,
  BracketEntry,
  BracketEntryWithRank,
  BracketGame,
  BracketSide,
  BracketSize,
  BracketStatus,
  CreateBracketBody,
  CreateEntryBody,
  CreateGameBody,
  CreateTemplateBody,
  EventBracketGame,
  GameStatus,
  GenerateEntriesResult,
  GenerateGamesResult,
  PatchBracketBody,
  TeamAssignmentConflict,
  BracketRankingsResponse,
} from '../../shared/brackets';
export { BRACKET_SIZES, nextPowerOfTwo } from '../../shared/brackets';

import type {
  BracketSide,
  BracketStatus,
  GameStatus,
} from '../../shared/brackets';

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
