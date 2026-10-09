import { describe, expect, it } from 'vitest';
import {
  compareLocaleString,
  compareNullable,
  compareNullableNumber,
  compareValues,
} from '../../src/client/components/table/sortUtils';
import { nextTableSort } from '../../src/client/components/table/useTableSort';

describe('compareValues', () => {
  it('orders numbers by direction and treats equal values as ties', () => {
    expect(compareValues(1, 2, 'asc')).toBe(-1);
    expect(compareValues(1, 2, 'desc')).toBe(1);
    expect(compareValues(2, 2, 'asc')).toBe(0);
  });

  it('orders machine strings such as ISO timestamps', () => {
    expect(
      compareValues('2026-01-02T00:00:00Z', '2026-01-10T00:00:00Z', 'asc'),
    ).toBe(-1);
  });
});

describe('compareLocaleString', () => {
  const names = ['Zeta', 'fox', 'Émile', 'Ellen'];

  it('sorts accented and mixed-case names in locale order', () => {
    expect([...names].sort((a, b) => compareLocaleString(a, b, 'asc'))).toEqual(
      ['Ellen', 'Émile', 'fox', 'Zeta'],
    );
    expect(
      [...names].sort((a, b) => compareLocaleString(a, b, 'desc')),
    ).toEqual(['Zeta', 'fox', 'Émile', 'Ellen']);
  });

  it('ignores case', () => {
    expect(compareLocaleString('ALPHA', 'alpha', 'asc')).toBe(0);
  });
});

describe('compareNullable', () => {
  it('sorts missing values last in both directions', () => {
    const values = [2, null, 1, undefined, 3];
    expect(
      [...values].sort((a, b) => compareNullableNumber(a, b, 'asc')),
    ).toEqual([1, 2, 3, null, undefined]);
    expect(
      [...values].sort((a, b) => compareNullableNumber(a, b, 'desc')),
    ).toEqual([3, 2, 1, null, undefined]);
  });

  it('delegates present values to the given comparator', () => {
    expect(compareNullable('b', 'A', 'asc', compareLocaleString)).toBe(1);
    expect(compareNullable(null, 'A', 'desc', compareLocaleString)).toBe(1);
  });
});

describe('nextTableSort', () => {
  const overallDefault = (field: string) =>
    field === 'total' ? 'desc' : 'asc';

  it('flips direction when the active column is selected again', () => {
    expect(
      nextTableSort({ field: 'total', direction: 'desc' }, 'total', 'asc'),
    ).toEqual({ field: 'total', direction: 'asc' });
  });

  it('applies the per-column default when switching columns', () => {
    const byName = nextTableSort(
      { field: 'total', direction: 'asc' },
      'team_name',
      overallDefault,
    );
    expect(byName).toEqual({ field: 'team_name', direction: 'asc' });
    expect(nextTableSort(byName, 'total', overallDefault)).toEqual({
      field: 'total',
      direction: 'desc',
    });
  });
});
