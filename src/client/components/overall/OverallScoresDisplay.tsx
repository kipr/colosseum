import React, { useCallback, useMemo, useState } from 'react';
import { UnifiedTable } from '../table';
import type { UnifiedColumnDef } from '../table';
import type { OverallScoreRow } from '../../../shared/api';
import '../admin/DocumentationTab.css';

interface OverallScoresDisplayProps {
  rows: readonly OverallScoreRow[];
  variant?: 'default' | 'spectator';
}

type SortField =
  | 'team_number'
  | 'team_name'
  | 'doc_score'
  | 'raw_seed_score'
  | 'weighted_de_score'
  | 'total';

type SortDirection = 'asc' | 'desc';

function formatScore(val: number): string {
  return val.toFixed(4);
}

export default function OverallScoresDisplay({
  rows,
  variant = 'default',
}: OverallScoresDisplayProps) {
  const isSpectator = variant === 'spectator';
  const [sortField, setSortField] = useState<SortField>('total');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  const sortedRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      switch (sortField) {
        case 'team_number':
          aVal = a.team_number;
          bVal = b.team_number;
          break;
        case 'team_name':
          aVal = a.team_name.toLowerCase();
          bVal = b.team_name.toLowerCase();
          break;
        case 'doc_score':
          aVal = a.doc_score;
          bVal = b.doc_score;
          break;
        case 'raw_seed_score':
          aVal = a.raw_seed_score;
          bVal = b.raw_seed_score;
          break;
        case 'weighted_de_score':
          aVal = a.weighted_de_score;
          bVal = b.weighted_de_score;
          break;
        case 'total':
          aVal = a.total;
          bVal = b.total;
          break;
        default:
          return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [rows, sortDirection, sortField]);

  const handleSort = useCallback(
    (field: string) => {
      const f = field as SortField;
      if (sortField === f) {
        setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
        return;
      }

      setSortField(f);
      setSortDirection(f === 'total' ? 'desc' : 'asc');
    },
    [sortField],
  );

  const stickyNum = isSpectator
    ? 'sticky-col sticky-col-team-number overall-team-number-col'
    : '';
  const stickyName = isSpectator
    ? 'sticky-col sticky-col-team-name overall-team-name-col'
    : '';
  const stickyNumCell = isSpectator
    ? 'sticky-col sticky-col-team-number overall-team-number-cell'
    : '';
  const stickyNameCell = isSpectator
    ? 'sticky-col sticky-col-team-name overall-team-name-cell'
    : '';

  const columns: UnifiedColumnDef<OverallScoreRow>[] = useMemo(
    () => [
      {
        kind: 'data',
        id: 'team_number',
        sortable: true,
        header: { full: 'Team #', short: '#' },
        headerClassName: ['doc-sortable', stickyNum].filter(Boolean).join(' '),
        cellClassName: stickyNumCell,
        sortAriaLabel: 'Sort by team number',
        renderCell: (row) => row.team_number,
      },
      {
        kind: 'data',
        id: 'team_name',
        sortable: true,
        header: { full: 'Team Name', short: 'Name' },
        headerClassName: ['doc-sortable', stickyName].filter(Boolean).join(' '),
        cellClassName: stickyNameCell,
        sortAriaLabel: 'Sort by team name',
        renderCell: (row) => (
          <span
            className="overall-team-name-text"
            title={row.team_name || undefined}
          >
            {row.team_name}
          </span>
        ),
      },
      {
        kind: 'data',
        id: 'doc_score',
        sortable: true,
        header: { full: 'Doc Score', short: 'Doc' },
        headerClassName: 'overall-doc-col doc-sortable',
        cellClassName: 'overall-doc-cell',
        sortAriaLabel: 'Sort by doc score',
        renderCell: (row) => formatScore(row.doc_score),
      },
      { kind: 'separator', id: 'sep-plus-1', symbol: '+' },
      {
        kind: 'data',
        id: 'raw_seed_score',
        sortable: true,
        header: { full: 'Raw Seeding', short: 'Seed' },
        headerClassName: 'overall-raw-seed-col doc-sortable',
        cellClassName: 'overall-raw-seed-cell',
        sortAriaLabel: 'Sort by raw seed score',
        renderCell: (row) => formatScore(row.raw_seed_score),
      },
      { kind: 'separator', id: 'sep-plus-2', symbol: '+' },
      {
        kind: 'data',
        id: 'weighted_de_score',
        sortable: true,
        header: { full: 'Weighted DE', short: 'DE' },
        headerClassName: 'overall-weighted-de-col doc-sortable',
        cellClassName: 'overall-weighted-de-cell',
        sortAriaLabel: 'Sort by weighted DE',
        renderCell: (row) => formatScore(row.weighted_de_score),
      },
      { kind: 'separator', id: 'sep-eq', symbol: '=' },
      {
        kind: 'data',
        id: 'total',
        sortable: true,
        header: { full: 'Total', short: 'Total' },
        headerClassName: 'overall-total-col doc-sortable',
        cellClassName: 'overall-total-cell',
        sortAriaLabel: 'Sort by total',
        renderCell: (row) => (
          <strong style={{ color: 'var(--primary-color)' }}>
            {formatScore(row.total)}
          </strong>
        ),
      },
    ],
    [stickyName, stickyNameCell, stickyNum, stickyNumCell],
  );

  return (
    <div
      className={`card documentation-section${isSpectator ? ' overall-section-spectator' : ''}`}
    >
      <h3>Overall Scores</h3>
      <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
        Combined score per team: Documentation + Raw Seeding (0&ndash;1) +
        Weighted DE. Sorted by total descending.
      </p>
      {sortedRows.length === 0 ? (
        <p style={{ color: 'var(--secondary-color)' }}>
          No scores available yet.
        </p>
      ) : (
        <UnifiedTable
          columns={columns}
          rows={sortedRows}
          getRowKey={(row) => row.team_id}
          activeSortId={sortField}
          sortDirection={sortDirection}
          onSort={handleSort}
          headerLabelVariant="doc"
          wrapperClassName={`doc-scores-table-wrapper${isSpectator ? ' overall-scores-table-wrapper-spectator' : ''}`}
          tableClassName={`doc-calculator-table${isSpectator ? ' overall-scores-table-spectator' : ''}`}
        />
      )}
    </div>
  );
}
