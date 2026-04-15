import React, { useCallback, useMemo, useState } from 'react';
import '../admin/DocumentationTab.css';

export interface OverallRow {
  team_id: number;
  team_number: number;
  team_name: string;
  doc_score: number;
  raw_seed_score: number;
  weighted_de_score: number;
  total: number;
}

interface OverallScoresDisplayProps {
  rows: OverallRow[];
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
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection((current) => (current === 'asc' ? 'desc' : 'asc'));
        return;
      }

      setSortField(field);
      setSortDirection(field === 'total' ? 'desc' : 'asc');
    },
    [sortField],
  );

  const getSortIndicator = (field: SortField) =>
    sortField === field ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '';

  const isActiveSortField = (field: SortField) => sortField === field;

  const getHeaderClassName = (field: SortField, ...classNames: string[]) =>
    [
      ...classNames,
      'doc-sortable',
      isActiveSortField(field) ? 'active-sort-col' : '',
    ]
      .filter(Boolean)
      .join(' ');

  const getCellClassName = (field: SortField, ...classNames: string[]) =>
    [...classNames, isActiveSortField(field) ? 'active-sort-col' : '']
      .filter(Boolean)
      .join(' ');

  const renderHeaderLabel = (
    fullLabel: string,
    shortLabel?: string,
    field?: SortField,
  ) => (
    <>
      <span className="doc-header-label-full">{fullLabel}</span>
      {shortLabel ? (
        <span className="doc-header-label-short" aria-hidden="true">
          {shortLabel}
        </span>
      ) : null}
      {field ? getSortIndicator(field) : null}
    </>
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
        <div
          className={`doc-scores-table-wrapper${isSpectator ? ' overall-scores-table-wrapper-spectator' : ''}`}
        >
          <table
            className={`doc-calculator-table${isSpectator ? ' overall-scores-table-spectator' : ''}`}
          >
            <thead>
              <tr>
                <th
                  className={getHeaderClassName(
                    'team_number',
                    isSpectator
                      ? 'sticky-col sticky-col-team-number overall-team-number-col'
                      : '',
                  )}
                  onClick={() => handleSort('team_number')}
                >
                  {renderHeaderLabel('Team #', 'Team', 'team_number')}
                </th>
                <th
                  className={getHeaderClassName(
                    'team_name',
                    isSpectator
                      ? 'sticky-col sticky-col-team-name overall-team-name-col'
                      : '',
                  )}
                  onClick={() => handleSort('team_name')}
                >
                  {renderHeaderLabel('Team Name', 'Name', 'team_name')}
                </th>
                <th
                  className={getHeaderClassName('doc_score', 'overall-doc-col')}
                  onClick={() => handleSort('doc_score')}
                >
                  {renderHeaderLabel('Doc Score', 'Doc', 'doc_score')}
                </th>
                <th className="doc-op">+</th>
                <th
                  className={getHeaderClassName(
                    'raw_seed_score',
                    'overall-raw-seed-col',
                  )}
                  onClick={() => handleSort('raw_seed_score')}
                >
                  {renderHeaderLabel('Raw Seeding', 'Seed', 'raw_seed_score')}
                </th>
                <th className="doc-op">+</th>
                <th
                  className={getHeaderClassName(
                    'weighted_de_score',
                    'overall-weighted-de-col',
                  )}
                  onClick={() => handleSort('weighted_de_score')}
                >
                  {renderHeaderLabel('Weighted DE', 'DE', 'weighted_de_score')}
                </th>
                <th className="doc-op">=</th>
                <th
                  className={getHeaderClassName('total', 'overall-total-col')}
                  onClick={() => handleSort('total')}
                >
                  {renderHeaderLabel('Total', 'Total', 'total')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.team_id}>
                  <td
                    className={getCellClassName(
                      'team_number',
                      isSpectator
                        ? 'sticky-col sticky-col-team-number overall-team-number-cell'
                        : '',
                    )}
                  >
                    {row.team_number}
                  </td>
                  <td
                    className={getCellClassName(
                      'team_name',
                      isSpectator
                        ? 'sticky-col sticky-col-team-name overall-team-name-cell'
                        : '',
                    )}
                  >
                    {row.team_name}
                  </td>
                  <td
                    className={getCellClassName(
                      'doc_score',
                      'overall-doc-cell',
                    )}
                  >
                    {formatScore(row.doc_score)}
                  </td>
                  <td className="doc-op">+</td>
                  <td
                    className={getCellClassName(
                      'raw_seed_score',
                      'overall-raw-seed-cell',
                    )}
                  >
                    {formatScore(row.raw_seed_score)}
                  </td>
                  <td className="doc-op">+</td>
                  <td
                    className={getCellClassName(
                      'weighted_de_score',
                      'overall-weighted-de-cell',
                    )}
                  >
                    {formatScore(row.weighted_de_score)}
                  </td>
                  <td className="doc-op">=</td>
                  <td
                    className={getCellClassName('total', 'overall-total-cell')}
                  >
                    <strong style={{ color: 'var(--primary-color)' }}>
                      {formatScore(row.total)}
                    </strong>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
