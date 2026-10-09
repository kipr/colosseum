import { useCallback, useState } from 'react';
import type { SortDirection } from './types';

export interface TableSortState<F extends string> {
  field: F;
  direction: SortDirection;
}

type DefaultDirection<F extends string> =
  | SortDirection
  | ((field: F) => SortDirection);

/** The sortable fields: a list, or a guard for open-ended ids like `cat_${n}`. */
export type TableSortFields<F extends string> =
  | readonly F[]
  | ((sortId: string) => sortId is F);

function resolveDirection<F extends string>(
  defaultDirection: DefaultDirection<F>,
  field: F,
): SortDirection {
  return typeof defaultDirection === 'function'
    ? defaultDirection(field)
    : defaultDirection;
}

function isSortField<F extends string>(
  fields: TableSortFields<F>,
  sortId: string,
): sortId is F {
  return typeof fields === 'function'
    ? fields(sortId)
    : (fields as readonly string[]).includes(sortId);
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

interface UseTableSortOptions<F extends string> {
  initialField: F;
  /** Must be stable (module-level), like `defaultDirection`. */
  fields: TableSortFields<F>;
  /** Direction for the initial column and each newly selected column. */
  defaultDirection?: DefaultDirection<F>;
}

/**
 * Sort state for a `UnifiedTable`. `onSort` can be passed straight to
 * `UnifiedTable`; ids outside `fields` are ignored so the header never shows
 * an active sort the comparator does not handle.
 */
export function useTableSort<F extends string>({
  initialField,
  fields,
  defaultDirection = 'asc',
}: UseTableSortOptions<F>): {
  sortField: F;
  sortDirection: SortDirection;
  onSort: (sortId: string) => void;
} {
  const [sort, setSort] = useState<TableSortState<F>>(() => ({
    field: initialField,
    direction: resolveDirection(defaultDirection, initialField),
  }));

  const onSort = useCallback(
    (sortId: string) => {
      if (!isSortField(fields, sortId)) {
        console.warn(`useTableSort: ignoring unknown sort id "${sortId}"`);
        return;
      }
      setSort((prev) => nextTableSort(prev, sortId, defaultDirection));
    },
    [fields, defaultDirection],
  );

  return { sortField: sort.field, sortDirection: sort.direction, onSort };
}
