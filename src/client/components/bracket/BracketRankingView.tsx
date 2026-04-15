import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { BracketEntryWithRank } from '../../types/brackets';
import './BracketDisplay.css';

interface BracketRankingViewProps {
  bracketId: number;
  rankings: BracketEntryWithRank[] | null;
  weight: number;
  loading: boolean;
  onRefresh?: () => void;
  variant?: 'default' | 'spectator';
}

function getRankLabel(rank: number): string {
  if (rank === 1) return '1st';
  if (rank === 2) return '2nd';
  if (rank === 3) return '3rd';
  return `${rank}th`;
}

function getRankRowClass(rank: number | null): string {
  if (rank === 1) return 'ranking-row-gold';
  if (rank === 2) return 'ranking-row-silver';
  if (rank === 3) return 'ranking-row-bronze';
  return '';
}

type SortField =
  | 'place'
  | 'team_number'
  | 'team_name'
  | 'raw_score'
  | 'doc_score'
  | 'raw_seeding'
  | 'weighted_de'
  | 'total';
type SortDirection = 'asc' | 'desc';

function getTeamName(entry: BracketEntryWithRank): string {
  return entry.team_name ?? entry.display_name ?? '';
}

function formatScore(value: number): string {
  return value.toFixed(4);
}

export default function BracketRankingView({
  rankings,
  weight,
  loading,
  onRefresh,
  variant = 'default',
}: BracketRankingViewProps) {
  const refreshedRef = useRef(false);
  const [sortField, setSortField] = useState<SortField>('place');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const isSpectator = variant === 'spectator';

  useEffect(() => {
    if (!refreshedRef.current && onRefresh) {
      refreshedRef.current = true;
      onRefresh();
    }
  }, [onRefresh]);

  const realEntries = useMemo(
    () => (rankings ?? []).filter((entry) => !entry.is_bye),
    [rankings],
  );
  const rankedCount = useMemo(
    () => realEntries.filter((entry) => entry.final_rank !== null).length,
    [realEntries],
  );

  const sortedEntries = useMemo(() => {
    const sorted = [...realEntries].sort((a, b) => {
      let compare = 0;
      switch (sortField) {
        case 'place': {
          const aVal = a.final_rank ?? Number.POSITIVE_INFINITY;
          const bVal = b.final_rank ?? Number.POSITIVE_INFINITY;
          compare = aVal - bVal;
          break;
        }
        case 'team_number': {
          const aVal = a.team_number ?? Number.POSITIVE_INFINITY;
          const bVal = b.team_number ?? Number.POSITIVE_INFINITY;
          compare = aVal - bVal;
          break;
        }
        case 'team_name': {
          compare = getTeamName(a)
            .toLowerCase()
            .localeCompare(getTeamName(b).toLowerCase());
          break;
        }
        case 'raw_score':
          compare = (a.bracket_raw_score ?? 0) - (b.bracket_raw_score ?? 0);
          break;
        case 'doc_score':
          compare = a.doc_score - b.doc_score;
          break;
        case 'raw_seeding':
          compare = a.raw_seed_score - b.raw_seed_score;
          break;
        case 'weighted_de':
          compare =
            (a.weighted_bracket_raw_score ?? 0) -
            (b.weighted_bracket_raw_score ?? 0);
          break;
        case 'total':
          compare = a.total - b.total;
          break;
        default:
          compare = 0;
      }

      if (compare === 0) {
        return a.id - b.id;
      }
      return sortDirection === 'asc' ? compare : -compare;
    });
    return sorted;
  }, [realEntries, sortDirection, sortField]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection((dir) => (dir === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDirection('asc');
      }
    },
    [sortField],
  );

  const getSortIndicator = useCallback(
    (field: SortField) =>
      sortField === field ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '',
    [sortDirection, sortField],
  );

  const isActiveSortField = useCallback(
    (field: SortField) => sortField === field,
    [sortField],
  );

  const getHeaderClassName = useCallback(
    (field: SortField, ...classNames: string[]) =>
      [
        ...classNames,
        'ranking-sortable',
        isActiveSortField(field) ? 'ranking-active-sort-col' : '',
      ]
        .filter(Boolean)
        .join(' '),
    [isActiveSortField],
  );

  const getCellClassName = useCallback(
    (field: SortField, ...classNames: string[]) =>
      [...classNames, isActiveSortField(field) ? 'ranking-active-sort-col' : '']
        .filter(Boolean)
        .join(' '),
    [isActiveSortField],
  );

  const renderHeaderLabel = useCallback(
    (fullLabel: string, shortLabel?: string, field?: SortField) => (
      <>
        <span className="ranking-header-label-full">{fullLabel}</span>
        {shortLabel ? (
          <span className="ranking-header-label-short" aria-hidden="true">
            {shortLabel}
          </span>
        ) : null}
        {field ? getSortIndicator(field) : null}
      </>
    ),
    [getSortIndicator],
  );

  if (loading) {
    return (
      <div
        className={`card bracket-section${isSpectator ? ' bracket-section-spectator' : ''}`}
      >
        <p>Loading rankings...</p>
      </div>
    );
  }

  if (realEntries.length === 0) {
    return (
      <div
        className={`card bracket-section${isSpectator ? ' bracket-section-spectator' : ''}`}
      >
        <div className="bracket-section-header">
          <h4>Rankings</h4>
        </div>
        <p style={{ color: 'var(--secondary-color)' }}>
          No rankings available. Rankings are calculated as bracket games are
          completed.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`card bracket-section${isSpectator ? ' bracket-section-spectator' : ''}`}
    >
      <div className="bracket-section-header">
        <div>
          <h4>Rankings ({rankedCount} placed)</h4>
          <p className="bracket-section-description">
            Overall is the sum of doc score, raw seeding, and weighted DE.
          </p>
        </div>
      </div>

      <div
        className={`bracket-ranking-table-responsive${isSpectator ? ' bracket-ranking-table-responsive-spectator' : ''}`}
      >
        <table
          className={`ranking-table${isSpectator ? ' ranking-table-spectator' : ''}`}
        >
          <thead>
            <tr>
              <th
                className={getHeaderClassName(
                  'place',
                  'ranking-place-col',
                  'sticky-col',
                  'sticky-col-place',
                )}
                onClick={() => handleSort('place')}
                title="DE Place"
                aria-label="Sort by DE place"
              >
                {renderHeaderLabel('DE Place', 'Place', 'place')}
              </th>
              <th
                className={getHeaderClassName(
                  'team_number',
                  'ranking-team-number-col',
                  'sticky-col',
                  'sticky-col-team-number',
                )}
                onClick={() => handleSort('team_number')}
                title="Team Number"
                aria-label="Sort by team number"
              >
                {renderHeaderLabel('Team #', '#', 'team_number')}
              </th>
              <th
                className={getHeaderClassName(
                  'team_name',
                  'ranking-team-name-col',
                  'sticky-col',
                  'sticky-col-team-name',
                )}
                onClick={() => handleSort('team_name')}
                title="Team Name"
                aria-label="Sort by team name"
              >
                {renderHeaderLabel('Team Name', 'Name', 'team_name')}
              </th>
              <th
                className={getHeaderClassName(
                  'raw_score',
                  'ranking-raw-score-col',
                )}
                onClick={() => handleSort('raw_score')}
                title="Raw DE Score"
                aria-label="Sort by raw DE score"
              >
                {renderHeaderLabel('Raw DE Score', 'Raw DE', 'raw_score')}
              </th>
              <th
                className={getHeaderClassName(
                  'doc_score',
                  'ranking-doc-score-col',
                )}
                onClick={() => handleSort('doc_score')}
                title="Doc Score"
                aria-label="Sort by doc score"
              >
                {renderHeaderLabel('Doc Score', 'Doc', 'doc_score')}
              </th>
              <th
                className={getHeaderClassName(
                  'raw_seeding',
                  'ranking-raw-seeding-col',
                )}
                onClick={() => handleSort('raw_seeding')}
                title="Raw Seeding"
                aria-label="Sort by raw seeding"
              >
                {renderHeaderLabel('Raw Seeding', 'Seed', 'raw_seeding')}
              </th>
              <th
                className={getHeaderClassName(
                  'weighted_de',
                  'ranking-weighted-de-col',
                )}
                onClick={() => handleSort('weighted_de')}
                title={`Weighted DE (w=${weight})`}
                aria-label="Sort by weighted DE"
              >
                {renderHeaderLabel('DE', 'DE', 'weighted_de')}
              </th>
              <th
                className={getHeaderClassName('total', 'ranking-total-col')}
                title="Sum of doc score, raw seeding, and weighted DE"
                aria-label="Sort by overall score"
                onClick={() => handleSort('total')}
              >
                {renderHeaderLabel('Overall', 'Total', 'total')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedEntries.map((entry) => (
              <tr key={entry.id} className={getRankRowClass(entry.final_rank)}>
                <td
                  className={getCellClassName(
                    'place',
                    'ranking-place',
                    'sticky-col',
                    'sticky-col-place',
                  )}
                >
                  {entry.final_rank !== null ? (
                    <strong>{getRankLabel(entry.final_rank)}</strong>
                  ) : (
                    <span style={{ color: 'var(--secondary-color)' }}>—</span>
                  )}
                </td>
                <td
                  className={getCellClassName(
                    'team_number',
                    'ranking-team-number-cell',
                    'sticky-col',
                    'sticky-col-team-number',
                  )}
                >
                  {entry.team_number ?? '—'}
                </td>
                <td
                  className={getCellClassName(
                    'team_name',
                    'ranking-team-name-cell',
                    'sticky-col',
                    'sticky-col-team-name',
                  )}
                >
                  <span
                    className="team-name-text"
                    title={getTeamName(entry) || undefined}
                  >
                    {getTeamName(entry) || '—'}
                  </span>
                </td>
                <td
                  className={getCellClassName(
                    'raw_score',
                    'ranking-raw-score-cell',
                  )}
                >
                  {entry.bracket_raw_score != null
                    ? formatScore(entry.bracket_raw_score)
                    : '—'}
                </td>
                <td
                  className={getCellClassName(
                    'doc_score',
                    'ranking-doc-score-cell',
                  )}
                >
                  {formatScore(entry.doc_score)}
                </td>
                <td
                  className={getCellClassName(
                    'raw_seeding',
                    'ranking-raw-seeding-cell',
                  )}
                >
                  {formatScore(entry.raw_seed_score)}
                </td>
                <td
                  className={getCellClassName(
                    'weighted_de',
                    'ranking-weighted-de-cell',
                  )}
                >
                  {entry.weighted_bracket_raw_score != null
                    ? formatScore(entry.weighted_bracket_raw_score)
                    : '—'}
                </td>
                <td className={getCellClassName('total', 'ranking-total-cell')}>
                  <strong style={{ color: 'var(--primary-color)' }}>
                    {formatScore(entry.total)}
                  </strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
