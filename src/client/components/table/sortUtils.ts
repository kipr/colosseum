import type { SortDirection } from './types';

/**
 * Compare two already-extracted sort values with `<` / `>` (code-unit order for
 * strings). Callers map missing values (e.g. `?? -Infinity`, `|| ''`) before
 * calling, so their placement is decided by the caller.
 */
export function compareValues(
  a: string | number,
  b: string | number,
  dir: SortDirection,
): number {
  if (a < b) return dir === 'asc' ? -1 : 1;
  if (a > b) return dir === 'asc' ? 1 : -1;
  return 0;
}

/**
 * Apply a sort direction to a raw ascending comparison (e.g. a subtraction or
 * `localeCompare` result). Lets callers add an unreversed tie breaker afterward.
 */
export function applySortDirection(
  compare: number,
  dir: SortDirection,
): number {
  return dir === 'asc' ? compare : -compare;
}

/**
 * Compare nullable numbers; null/undefined sort after non-null (toward end in asc).
 */
export function compareNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: SortDirection,
): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  return compareValues(a, b, dir);
}

/**
 * Case-insensitive string compare with direction. Uses code-unit order on the
 * lowercased strings, not `localeCompare`.
 */
export function compareLocaleString(
  a: string,
  b: string,
  dir: SortDirection,
): number {
  return compareValues(a.toLowerCase(), b.toLowerCase(), dir);
}
