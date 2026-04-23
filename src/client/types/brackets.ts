/**
 * Bracket-related types shared across components.
 *
 * Canonical enums, DTOs, and label maps live in `src/shared/domain/bracket.ts`
 * so the server, client, and DB schema all use the same definitions.  This
 * file re-exports them so existing relative imports keep working.
 */

export {
  BRACKET_STATUSES,
  type BracketStatus,
  GAME_STATUSES,
  type GameStatus,
  BRACKET_SIDES,
  type BracketSide,
  BRACKET_STATUS_LABELS,
  GAME_STATUS_LABELS,
  GAME_STATUS_DISPLAY_LABELS,
  BRACKET_SIDE_LABELS,
  type Bracket,
  type BracketEntry,
  type BracketEntryWithRank,
  type BracketGame,
  type BracketDetail,
} from '../../shared/domain';
