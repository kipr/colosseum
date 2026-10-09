import { useEffect, useMemo, useRef } from 'react';
import { BracketEntryWithRank } from '../../types/brackets';
import {
  compareLocaleString,
  compareNullableNumber,
  compareValues,
  UnifiedTable,
  useTableSort,
} from '../table';
import type { SortDirection } from '../table';
import type { UnifiedColumnDef } from '../table';
import '../seeding/SeedingTables.css';

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

const SORT_FIELDS = [
  'place',
  'team_number',
  'team_name',
  'raw_score',
  'doc_score',
  'raw_seeding',
  'raw_double_seeding',
  'weighted_de',
  'total',
] as const;
type SortField = (typeof SORT_FIELDS)[number];

function getTeamName(entry: BracketEntryWithRank): string {
  return entry.team_name ?? entry.display_name ?? '';
}

function formatScore(value: number): string {
  return value.toFixed(4);
}

/** Missing ranks, numbers and scores sort last in both directions. */
function compareEntries(
  a: BracketEntryWithRank,
  b: BracketEntryWithRank,
  field: SortField,
  dir: SortDirection,
): number {
  switch (field) {
    case 'place':
      return compareNullableNumber(a.final_rank, b.final_rank, dir);
    case 'team_number':
      return compareNullableNumber(a.team_number, b.team_number, dir);
    case 'team_name':
      return compareLocaleString(getTeamName(a), getTeamName(b), dir);
    case 'raw_score':
      return compareNullableNumber(
        a.bracket_raw_score,
        b.bracket_raw_score,
        dir,
      );
    case 'doc_score':
      return compareValues(a.doc_score, b.doc_score, dir);
    case 'raw_seeding':
      return compareValues(a.raw_seed_score, b.raw_seed_score, dir);
    case 'raw_double_seeding':
      return compareValues(
        a.raw_double_seed_score,
        b.raw_double_seed_score,
        dir,
      );
    case 'weighted_de':
      return compareNullableNumber(
        a.weighted_bracket_raw_score,
        b.weighted_bracket_raw_score,
        dir,
      );
    case 'total':
      return compareValues(a.total, b.total, dir);
  }
}

export default function BracketRankingView(props: BracketRankingViewProps) {
  const { rankings, weight, loading, onRefresh, variant = 'default' } = props;
  const refreshedRef = useRef(false);
  const { sortField, sortDirection, onSort } = useTableSort<SortField>({
    initialField: 'place',
    fields: SORT_FIELDS,
  });
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
    const sorted = [...realEntries].sort(
      (a, b) => compareEntries(a, b, sortField, sortDirection) || a.id - b.id,
    );
    return sorted;
  }, [realEntries, sortDirection, sortField]);

  const stickyRank = isSpectator ? 'sticky-col sticky-col-rank' : '';
  const stickyNum = isSpectator ? 'sticky-col sticky-col-team-number' : '';
  const stickyName = isSpectator ? 'sticky-col sticky-col-team-name' : '';

  const columns: UnifiedColumnDef<BracketEntryWithRank>[] = useMemo(
    () => [
      {
        kind: 'data',
        id: 'place',
        sortable: true,
        header: { full: 'DE Place', short: 'Place' },
        headerClassName: ['seed-rank-col', 'sortable', stickyRank]
          .filter(Boolean)
          .join(' '),
        cellClassName: ['rank-cell', stickyRank].filter(Boolean).join(' '),
        title: 'DE Place',
        sortAriaLabel: 'Sort by DE place',
        renderCell: (entry) =>
          entry.final_rank !== null ? (
            <strong>{getRankLabel(entry.final_rank)}</strong>
          ) : (
            <span style={{ color: 'var(--secondary-color)' }}>—</span>
          ),
      },
      {
        kind: 'data',
        id: 'team_number',
        sortable: true,
        header: { full: 'Team #', short: '#' },
        headerClassName: ['team-number-col', 'sortable', stickyNum]
          .filter(Boolean)
          .join(' '),
        cellClassName: ['team-number-cell', stickyNum]
          .filter(Boolean)
          .join(' '),
        title: 'Team Number',
        sortAriaLabel: 'Sort by team number',
        renderCell: (entry) => entry.team_number ?? '—',
      },
      {
        kind: 'data',
        id: 'team_name',
        sortable: true,
        header: { full: 'Team Name', short: 'Name' },
        headerClassName: ['team-name-col', 'sortable', stickyName]
          .filter(Boolean)
          .join(' '),
        cellClassName: ['team-name-cell', stickyName].filter(Boolean).join(' '),
        title: 'Team Name',
        sortAriaLabel: 'Sort by team name',
        renderCell: (entry) => (
          <span
            className="team-name-text"
            title={getTeamName(entry) || undefined}
          >
            {getTeamName(entry) || '—'}
          </span>
        ),
      },
      {
        kind: 'data',
        id: 'raw_score',
        sortable: true,
        header: { full: 'Raw DE Score', short: 'Raw DE' },
        headerClassName:
          'bracket-ranking-raw-de-col ranking-metric-col sortable',
        cellClassName: 'bracket-ranking-raw-de-cell ranking-metric-cell',
        title: 'Raw DE Score',
        sortAriaLabel: 'Sort by raw DE score',
        renderCell: (entry) =>
          entry.bracket_raw_score != null
            ? formatScore(entry.bracket_raw_score)
            : '—',
      },
      {
        kind: 'data',
        id: 'doc_score',
        sortable: true,
        header: { full: 'Doc Score', short: 'Doc' },
        headerClassName: 'ranking-metric-col sortable',
        cellClassName: 'ranking-metric-cell',
        title: 'Doc Score',
        sortAriaLabel: 'Sort by doc score',
        renderCell: (entry) => formatScore(entry.doc_score),
      },
      {
        kind: 'data',
        id: 'raw_seeding',
        sortable: true,
        header: { full: 'Raw Seeding', short: 'Seed' },
        headerClassName: 'ranking-metric-col sortable',
        cellClassName: 'ranking-metric-cell',
        title: 'Raw Seeding',
        sortAriaLabel: 'Sort by raw seeding',
        renderCell: (entry) => formatScore(entry.raw_seed_score),
      },
      {
        kind: 'data',
        id: 'raw_double_seeding',
        sortable: true,
        header: { full: 'Raw Double Seeding', short: '2x Seed' },
        headerClassName: 'ranking-metric-col sortable',
        cellClassName: 'ranking-metric-cell',
        title: 'Raw Double Seeding',
        sortAriaLabel: 'Sort by raw double seeding',
        renderCell: (entry) => formatScore(entry.raw_double_seed_score),
      },
      {
        kind: 'data',
        id: 'weighted_de',
        sortable: true,
        header: { full: 'DE', short: 'DE' },
        headerClassName: 'ranking-metric-col sortable',
        cellClassName: 'ranking-metric-cell',
        title: `Weighted DE (w=${weight})`,
        sortAriaLabel: 'Sort by weighted DE',
        renderCell: (entry) =>
          entry.weighted_bracket_raw_score != null
            ? formatScore(entry.weighted_bracket_raw_score)
            : '—',
      },
      {
        kind: 'data',
        id: 'total',
        sortable: true,
        header: { full: 'Overall', short: 'Total' },
        headerClassName: 'ranking-metric-col sortable',
        cellClassName: 'ranking-metric-cell',
        title:
          'Sum of doc score, raw seeding, raw double seeding, and weighted DE',
        sortAriaLabel: 'Sort by overall score',
        renderCell: (entry) => (
          <strong style={{ color: 'var(--primary-color)' }}>
            {formatScore(entry.total)}
          </strong>
        ),
      },
    ],
    [stickyName, stickyNum, stickyRank, weight],
  );

  if (loading) {
    return (
      <div
        className={`card seeding-section${isSpectator ? ' seeding-section-spectator' : ''}`}
      >
        <p>Loading rankings...</p>
      </div>
    );
  }

  if (realEntries.length === 0) {
    return (
      <div
        className={`card seeding-section${isSpectator ? ' seeding-section-spectator' : ''}`}
      >
        <div className="seeding-section-header">
          <h3>Rankings</h3>
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
      className={`card seeding-section${isSpectator ? ' seeding-section-spectator' : ''}`}
    >
      <div className="seeding-section-header">
        <div>
          <h3>Rankings ({rankedCount} placed)</h3>
          <p className="seeding-section-description">
            Overall is the sum of doc score, raw seeding, raw double seeding,
            and weighted DE.
          </p>
        </div>
      </div>

      <UnifiedTable
        columns={columns}
        rows={sortedEntries}
        getRowKey={(entry) => entry.id}
        activeSortId={sortField}
        sortDirection={sortDirection}
        onSort={onSort}
        headerLabelVariant="seeding"
        rowClassName={(entry) => getRankRowClass(entry.final_rank)}
        wrapperClassName={`table-responsive${isSpectator ? ' seeding-table-responsive-spectator' : ''}`}
        tableClassName={`seeding-table seeding-unified-table${isSpectator ? ' seeding-table-spectator' : ''}`}
      />
    </div>
  );
}
