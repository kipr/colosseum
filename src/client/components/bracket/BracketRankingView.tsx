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
}: BracketRankingViewProps) {
  const refreshedRef = useRef(false);
  const [sortField, setSortField] = useState<SortField>('place');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

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

  if (loading) {
    return (
      <div className="card bracket-section">
        <p>Loading rankings...</p>
      </div>
    );
  }

  if (realEntries.length === 0) {
    return (
      <div className="card bracket-section">
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
    <div className="card bracket-section">
      <div className="bracket-section-header">
        <h4>Rankings ({rankedCount} placed)</h4>
      </div>

      <table className="ranking-table">
        <thead>
          <tr>
            <th
              className="ranking-sortable"
              onClick={() => handleSort('place')}
            >
              Place{getSortIndicator('place')}
            </th>
            <th
              className="ranking-sortable"
              onClick={() => handleSort('team_number')}
            >
              Team #{getSortIndicator('team_number')}
            </th>
            <th
              className="ranking-sortable"
              onClick={() => handleSort('team_name')}
            >
              Team Name{getSortIndicator('team_name')}
            </th>
            <th
              className="ranking-sortable"
              onClick={() => handleSort('raw_score')}
            >
              Raw Score{getSortIndicator('raw_score')}
            </th>
            <th
              className="ranking-sortable"
              onClick={() => handleSort('doc_score')}
            >
              Doc Score{getSortIndicator('doc_score')}
            </th>
            <th
              className="ranking-sortable"
              onClick={() => handleSort('raw_seeding')}
            >
              Raw Seeding{getSortIndicator('raw_seeding')}
            </th>
            <th
              className="ranking-sortable"
              onClick={() => handleSort('weighted_de')}
            >
              Weighted DE (w={weight}){getSortIndicator('weighted_de')}
            </th>
            <th
              className="ranking-sortable"
              onClick={() => handleSort('total')}
            >
              Total{getSortIndicator('total')}
            </th>
          </tr>
        </thead>
        <tbody>
          {sortedEntries.map((entry) => (
            <tr key={entry.id} className={getRankRowClass(entry.final_rank)}>
              <td className="ranking-place">
                {entry.final_rank !== null ? (
                  <strong>{getRankLabel(entry.final_rank)}</strong>
                ) : (
                  <span style={{ color: 'var(--secondary-color)' }}>—</span>
                )}
              </td>
              <td>{entry.team_number ?? '—'}</td>
              <td>{getTeamName(entry) || '—'}</td>
              <td>
                {entry.bracket_raw_score != null
                  ? formatScore(entry.bracket_raw_score)
                  : '—'}
              </td>
              <td>{formatScore(entry.doc_score)}</td>
              <td>{formatScore(entry.raw_seed_score)}</td>
              <td>
                {entry.weighted_bracket_raw_score != null
                  ? formatScore(entry.weighted_bracket_raw_score)
                  : '—'}
              </td>
              <td>
                <strong style={{ color: 'var(--primary-color)' }}>
                  {formatScore(entry.total)}
                </strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
