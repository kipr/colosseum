import type { SortDirection } from './types';

/**
 * Compare two numbers or machine strings (ids, enum keys, ISO timestamps) with
 * `<` / `>`. Use `compareLocaleString` for display text.
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
 * Compare nullable values; null/undefined sort last in both directions, and
 * present values are compared with `compare`.
 */
export function compareNullable<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  dir: SortDirection,
  compare: (a: T, b: T, dir: SortDirection) => number,
): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  return compare(a, b, dir);
}

/**
 * Compare nullable numbers; null/undefined sort last in both directions.
 */
export function compareNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: SortDirection,
): number {
  return compareNullable(a, b, dir, compareValues);
}

const textCollator = new Intl.Collator(undefined, { sensitivity: 'accent' });

/**
 * Locale-aware, case-insensitive compare for display text (team names etc.).
 */
export function compareLocaleString(
  a: string,
  b: string,
  dir: SortDirection,
): number {
  const cmp = Math.sign(textCollator.compare(a, b));
  return dir === 'asc' ? cmp : -cmp;
}
