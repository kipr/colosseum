export { default as UnifiedTable } from './UnifiedTable';
export type {
  UnifiedActiveSortClass,
  UnifiedColumnDef,
  UnifiedDataColumn,
  UnifiedHeaderLabelVariant,
  UnifiedSeparatorColumn,
  UnifiedTableProps,
  SortDirection,
} from './types';
export {
  applySortDirection,
  compareLocaleString,
  compareNullableNumber,
  compareValues,
} from './sortUtils';
export { nextTableSort, useTableSort } from './useTableSort';
export type { TableSortState } from './useTableSort';
export {
  UnifiedTableScrollAffordanceProvider,
  useUnifiedTableScrollAffordance,
} from './UnifiedTableScrollAffordanceContext';
