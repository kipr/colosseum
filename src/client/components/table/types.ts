import type { CSSProperties, ReactNode } from 'react';

/** Sort direction for client-side sorted tables */
export type SortDirection = 'asc' | 'desc';

/**
 * Which header label CSS convention to use (maps to existing feature CSS).
 * - `seeding`: `.header-label-full` / `.header-label-short`
 * - `ranking`: `.ranking-header-label-full` / `.ranking-header-label-short`
 * - `doc`: `.doc-header-label-full` / `.doc-header-label-short`
 * - `none`: render label text only (no short/long split)
 */
export type UnifiedHeaderLabelVariant = 'seeding' | 'ranking' | 'doc' | 'none';

/** Active-sort column class names per feature (existing CSS). */
export type UnifiedActiveSortClass = 'active-sort-col';

export interface UnifiedDataColumn<TRow> {
  kind: 'data';
  id: string;
  /** Used for sort callbacks and aria; defaults to `id` */
  sortId?: string;
  sortable?: boolean;
  header: {
    full: string;
    short?: string;
  };
  /** Extra class names for `<th>` (sticky, column width, etc.) */
  headerClassName?: string;
  /** Per-cell class; active-sort column class is appended when applicable */
  cellClassName?: string | ((row: TRow) => string);
  renderCell: (row: TRow) => ReactNode;
  title?: string;
  /** Accessible label for sort button when sortable */
  sortAriaLabel?: string;
  headerStyle?: CSSProperties;
  cellStyle?: CSSProperties;
}

export interface UnifiedSeparatorColumn {
  kind: 'separator';
  id: string;
  symbol: string;
  headerClassName?: string;
  cellClassName?: string;
  headerStyle?: CSSProperties;
  cellStyle?: CSSProperties;
}

export type UnifiedColumnDef<TRow> =
  | UnifiedDataColumn<TRow>
  | UnifiedSeparatorColumn;

export interface UnifiedTableProps<TRow> {
  columns: Array<UnifiedColumnDef<TRow>>;
  rows: TRow[];
  getRowKey: (row: TRow) => string | number;
  /** When false, only `<tbody>` is rendered (e.g. medal-only tables). */
  showHeader?: boolean;
  activeSortId?: string | null;
  sortDirection?: SortDirection;
  onSort?: (sortId: string) => void;
  headerLabelVariant?: UnifiedHeaderLabelVariant;
  activeSortClassName?: UnifiedActiveSortClass;
  sortableHeaderClassName?: string;
  rowClassName?: (row: TRow) => string | undefined;
  wrapperClassName?: string;
  tableClassName?: string;
  /** Optional caption for accessibility */
  caption?: ReactNode;
  /** Class for the sort `<button>` inside sortable headers (default: `unified-table-sort-btn`) */
  sortButtonClassName?: string;
  /** When false, active sort is not reflected on body cells (headers still show aria-sort). */
  highlightActiveColumn?: boolean;
  /** Appended inside `<tbody>` after mapped rows (e.g. a colspan “…and N more” row). */
  tbodyExtra?: ReactNode;
}
