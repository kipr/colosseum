import { useCallback, useRef, useState } from 'react';
import type { SortDirection } from './types';

export interface TableSortState<F extends string> {
  field: F;
  direction: SortDirection;
}

type DefaultDirection<F extends string> =
  | SortDirection
  | ((field: F) => SortDirection);

function resolveDirection<F extends string>(
  defaultDirection: DefaultDirection<F>,
  field: F,
): SortDirection {
  return typeof defaultDirection === 'function'
    ? defaultDirection(field)
    : defaultDirection;
}

/**
 * Next sort state after a header click: the active column flips direction,
 * any other column becomes active with its default direction.
 */
export function nextTableSort<F extends string>(
  prev: TableSortState<F>,
  field: F,
  defaultDirection: DefaultDirection<F>,
): TableSortState<F> {
  if (prev.field === field) {
    return {
      field,
      direction: prev.direction === 'asc' ? 'desc' : 'asc',
    };
  }
  return { field, direction: resolveDirection(defaultDirection, field) };
}

/**
 * Sort state for a `UnifiedTable`. `defaultDirection` (a direction, or a
 * per-column function) applies to the initial column and to each newly
 * selected column. `onSort` can be passed straight to `UnifiedTable`.
 */
export function useTableSort<F extends string>(
  initialField: F,
  defaultDirection: DefaultDirection<F> = 'asc',
): {
  sortField: F;
  sortDirection: SortDirection;
  onSort: (sortId: string) => void;
} {
  const [sort, setSort] = useState<TableSortState<F>>(() => ({
    field: initialField,
    direction: resolveDirection(defaultDirection, initialField),
  }));
  const defaultDirectionRef = useRef(defaultDirection);
  defaultDirectionRef.current = defaultDirection;

  const onSort = useCallback((sortId: string) => {
    const direction = defaultDirectionRef.current;
    setSort((prev) => nextTableSort(prev, sortId as F, direction));
  }, []);

  return { sortField: sort.field, sortDirection: sort.direction, onSort };
}
