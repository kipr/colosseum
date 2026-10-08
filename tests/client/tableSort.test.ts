import { describe, expect, it } from 'vitest';
import {
  applySortDirection,
  compareLocaleString,
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

  it('keeps caller-mapped missing values where the mapping puts them', () => {
    const values = [3, -Infinity, 1];
    expect([...values].sort((a, b) => compareValues(a, b, 'asc'))).toEqual([
      -Infinity,
      1,
      3,
    ]);
    expect([...values].sort((a, b) => compareValues(a, b, 'desc'))).toEqual([
      3,
      1,
      -Infinity,
    ]);
  });

  it('uses code-unit string order rather than locale order', () => {
    expect(compareValues('Z', 'a', 'asc')).toBe(-1);
    expect(compareValues('é', 'f', 'asc')).toBe(1);
  });
});

describe('applySortDirection', () => {
  it('flips the sign only for descending sorts', () => {
    expect(applySortDirection(-3, 'asc')).toBe(-3);
    expect(applySortDirection(-3, 'desc')).toBe(3);
  });

  it('passes NaN through unchanged', () => {
    expect(applySortDirection(NaN, 'desc')).toBeNaN();
  });
});

describe('compareLocaleString', () => {
  it('compares lowercased strings in code-unit order', () => {
    expect(compareLocaleString('beta', 'Alpha', 'asc')).toBe(1);
    expect(compareLocaleString('ALPHA', 'alpha', 'desc')).toBe(0);
    expect(compareLocaleString('é', 'F', 'asc')).toBe(1);
  });
});

describe('compareNullableNumber', () => {
  it('sorts missing values last in both directions', () => {
    expect(compareNullableNumber(null, 1, 'asc')).toBe(1);
    expect(compareNullableNumber(null, 1, 'desc')).toBe(1);
    expect(compareNullableNumber(2, 1, 'desc')).toBe(-1);
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
