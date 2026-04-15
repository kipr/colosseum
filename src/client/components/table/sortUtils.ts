import type { SortDirection } from './types';

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
  if (a! < b!) return dir === 'asc' ? -1 : 1;
  if (a! > b!) return dir === 'asc' ? 1 : -1;
  return 0;
}

/**
 * Case-insensitive string compare with direction.
 */
export function compareLocaleString(
  a: string,
  b: string,
  dir: SortDirection,
): number {
  const av = a.toLowerCase();
  const bv = b.toLowerCase();
  if (av < bv) return dir === 'asc' ? -1 : 1;
  if (av > bv) return dir === 'asc' ? 1 : -1;
  return 0;
}
