/**
 * SQL enum helpers shared by table and migration modules.
 *
 * Renders an `IN (...)` SQL fragment from the canonical TypeScript enum arrays
 * in `src/shared/domain/*` so CHECK constraints stay in sync with the domain
 * definitions.
 *
 * Lives in its own module so per-table files can import it without pulling in
 * `init.ts` (which would create a circular dependency).
 */
import { EVENT_STATUSES } from '../../shared/domain/eventStatus';
import { SCORE_ACCEPT_MODES } from '../../shared/domain/scoreAcceptMode';
import { TEAM_STATUSES } from '../../shared/domain/teamStatus';
import { QUEUE_STATUSES, QUEUE_TYPES } from '../../shared/domain/queue';
import {
  BRACKET_STATUSES,
  BRACKET_SIDES,
  GAME_STATUSES,
} from '../../shared/domain/bracket';

export function sqlEnumIn(values: readonly string[]): string {
  return `(${values.map((v) => `'${v}'`).join(', ')})`;
}

export const EVENT_STATUS_SQL = sqlEnumIn(EVENT_STATUSES);
export const SCORE_ACCEPT_MODE_SQL = sqlEnumIn(SCORE_ACCEPT_MODES);
export const TEAM_STATUS_SQL = sqlEnumIn(TEAM_STATUSES);
export const QUEUE_STATUS_SQL = sqlEnumIn(QUEUE_STATUSES);
export const QUEUE_TYPE_SQL = sqlEnumIn(QUEUE_TYPES);
export const BRACKET_STATUS_SQL = sqlEnumIn(BRACKET_STATUSES);
export const BRACKET_SIDE_SQL = sqlEnumIn(BRACKET_SIDES);
export const GAME_STATUS_SQL = sqlEnumIn(GAME_STATUSES);
