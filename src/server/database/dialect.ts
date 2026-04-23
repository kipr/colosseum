/**
 * Dialect-aware DDL primitives.
 *
 * Schema definitions in `schema/` are written once and rendered to either
 * SQLite or PostgreSQL by passing a `Dialect` through these helpers. This
 * module also re-exports the enum CHECK constants used across table
 * definitions so `schema/tables.ts` has a single import surface.
 */

import {
  EVENT_STATUSES,
  SCORE_ACCEPT_MODES,
  TEAM_STATUSES,
  BRACKET_STATUSES,
  GAME_STATUSES,
  BRACKET_SIDES,
  QUEUE_STATUSES,
  QUEUE_TYPES,
  sqlEnumCheck,
} from '../../shared/domain';

export type Dialect = 'sqlite' | 'postgres';

export function idColumn(d: Dialect): string {
  return d === 'postgres'
    ? 'SERIAL PRIMARY KEY'
    : 'INTEGER PRIMARY KEY AUTOINCREMENT';
}

export function timestamp(d: Dialect): string {
  return d === 'postgres' ? 'TIMESTAMP' : 'DATETIME';
}

export function bigint(d: Dialect): string {
  return d === 'postgres' ? 'BIGINT' : 'INTEGER';
}

export function boolDefault(d: Dialect, value: boolean): string {
  if (d === 'postgres') {
    return `BOOLEAN DEFAULT ${value ? 'TRUE' : 'FALSE'}`;
  }
  return `BOOLEAN DEFAULT ${value ? 1 : 0}`;
}

export function boolLit(d: Dialect, value: boolean): string {
  if (d === 'postgres') {
    return value ? 'TRUE' : 'FALSE';
  }
  return value ? '1' : '0';
}

// Enum CHECK constants used by table definitions. These are dialect-agnostic
// and were previously declared at the top of init.ts.
export const eventStatusCheck = sqlEnumCheck('status', EVENT_STATUSES);
export const scoreAcceptModeCheck = sqlEnumCheck(
  'score_accept_mode',
  SCORE_ACCEPT_MODES,
);
export const teamStatusCheck = sqlEnumCheck('status', TEAM_STATUSES);
export const bracketStatusCheck = sqlEnumCheck('status', BRACKET_STATUSES);
export const gameStatusCheck = sqlEnumCheck('status', GAME_STATUSES);
export const bracketSideCheck = sqlEnumCheck('bracket_side', BRACKET_SIDES);
export const queueStatusCheck = sqlEnumCheck('status', QUEUE_STATUSES);
export const queueTypeCheck = sqlEnumCheck('queue_type', QUEUE_TYPES);

export const queueStatusValueList = QUEUE_STATUSES.map((s) => `'${s}'`).join(
  ', ',
);
