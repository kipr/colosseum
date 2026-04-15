import React, { useCallback } from 'react';
import type {
  UnifiedColumnDef,
  UnifiedDataColumn,
  UnifiedHeaderLabelVariant,
  UnifiedTableProps,
} from './types';
import './UnifiedTable.css';

function headerLabelSpans(
  variant: UnifiedHeaderLabelVariant,
  full: string,
  short: string | undefined,
  sortIndicator: string,
): React.ReactNode {
  if (variant === 'none') {
    return (
      <>
        {full}
        {sortIndicator}
      </>
    );
  }

  const fullClass =
    variant === 'seeding'
      ? 'header-label-full'
      : variant === 'ranking'
        ? 'ranking-header-label-full'
        : 'doc-header-label-full';

  const shortClass =
    variant === 'seeding'
      ? 'header-label-short'
      : variant === 'ranking'
        ? 'ranking-header-label-short'
        : 'doc-header-label-short';

  return (
    <>
      <span className={fullClass}>{full}</span>
      {short ? (
        <span className={shortClass} aria-hidden="true">
          {short}
        </span>
      ) : null}
      {sortIndicator}
    </>
  );
}

function mergeCellClass<TRow>(
  col: UnifiedDataColumn<TRow>,
  row: TRow,
  activeSortId: string | null | undefined,
  activeSortClassName: string,
  highlightActiveColumn: boolean,
): string {
  const base =
    typeof col.cellClassName === 'function'
      ? col.cellClassName(row)
      : (col.cellClassName ?? '');
  const sortId = col.sortId ?? col.id;
  const active =
    highlightActiveColumn &&
    col.sortable &&
    activeSortId === sortId &&
    activeSortClassName
      ? ` ${activeSortClassName}`
      : '';
  return [base, active].filter(Boolean).join(' ').trim();
}

export default function UnifiedTable<TRow>({
  columns,
  rows,
  getRowKey,
  showHeader = true,
  activeSortId,
  sortDirection = 'asc',
  onSort,
  headerLabelVariant = 'none',
  activeSortClassName = 'active-sort-col',
  sortableHeaderClassName,
  rowClassName,
  wrapperClassName,
  tableClassName,
  caption,
  sortButtonClassName = 'unified-table-sort-btn',
  /** When false, active-sort styling is not applied to headers or cells (sort indicators remain). */
  highlightActiveColumn = true,
  tbodyExtra,
}: UnifiedTableProps<TRow>) {
  const handleSortClick = useCallback(
    (sortId: string) => {
      onSort?.(sortId);
    },
    [onSort],
  );

  const renderHeaderCell = (col: UnifiedColumnDef<TRow>) => {
    if (col.kind === 'separator') {
      return (
        <th
          key={col.id}
          className={col.headerClassName ?? 'doc-op'}
          scope="col"
          style={col.headerStyle}
        >
          {col.symbol}
        </th>
      );
    }

    const sortId = col.sortId ?? col.id;
    const isActive = Boolean(col.sortable && activeSortId === sortId);
    const headerClasses = [
      col.headerClassName,
      col.sortable ? sortableHeaderClassName : '',
      highlightActiveColumn && isActive ? activeSortClassName : '',
    ]
      .filter(Boolean)
      .join(' ');

    const sortIndicator = isActive
      ? sortDirection === 'asc'
        ? ' ▲'
        : ' ▼'
      : '';

    const ariaSort = col.sortable
      ? isActive
        ? sortDirection === 'asc'
          ? 'ascending'
          : 'descending'
        : 'none'
      : undefined;

    const labelContent = headerLabelSpans(
      headerLabelVariant,
      col.header.full,
      col.header.short,
      sortIndicator,
    );

    if (col.sortable && onSort) {
      return (
        <th
          key={col.id}
          className={headerClasses || undefined}
          scope="col"
          title={col.title}
          style={col.headerStyle}
          aria-sort={
            ariaSort as 'ascending' | 'descending' | 'none' | undefined
          }
        >
          <button
            type="button"
            className={sortButtonClassName}
            onClick={() => handleSortClick(sortId)}
            aria-label={col.sortAriaLabel ?? `Sort by ${col.header.full}`}
          >
            {labelContent}
          </button>
        </th>
      );
    }

    return (
      <th
        key={col.id}
        className={headerClasses || undefined}
        scope="col"
        title={col.title}
        style={col.headerStyle}
      >
        {labelContent}
      </th>
    );
  };

  const renderBodyCell = (col: UnifiedColumnDef<TRow>, row: TRow) => {
    if (col.kind === 'separator') {
      return (
        <td
          key={col.id}
          className={col.cellClassName ?? 'doc-op'}
          style={col.cellStyle}
        >
          {col.symbol}
        </td>
      );
    }

    const cls = mergeCellClass(
      col,
      row,
      activeSortId,
      activeSortClassName,
      highlightActiveColumn,
    );
    return (
      <td key={col.id} className={cls || undefined} style={col.cellStyle}>
        {col.renderCell(row)}
      </td>
    );
  };

  const table = (
    <table className={tableClassName}>
      {caption ? <caption>{caption}</caption> : null}
      {showHeader ? (
        <thead>
          <tr>{columns.map((col) => renderHeaderCell(col))}</tr>
        </thead>
      ) : null}
      <tbody>
        {rows.map((row) => (
          <tr
            key={String(getRowKey(row))}
            className={rowClassName?.(row) ?? undefined}
          >
            {columns.map((col) => renderBodyCell(col, row))}
          </tr>
        ))}
        {tbodyExtra}
      </tbody>
    </table>
  );

  if (wrapperClassName) {
    return <div className={wrapperClassName}>{table}</div>;
  }

  return table;
}
