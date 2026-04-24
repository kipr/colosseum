import React, { useCallback, useMemo, useState } from 'react';
import {
  UnifiedTable,
  compareLocaleString,
  compareNullableNumber,
} from '../table';
import type { UnifiedColumnDef } from '../table';
import type { Team } from '../../../shared/domain';
import type { SeedingRanking, SeedingScore } from '../../../shared/api';
import './SeedingTables.css';

export interface TeamRowData {
  readonly team: Team;
  readonly scores: ReadonlyMap<number, SeedingScore | null>;
  readonly ranking: SeedingRanking | null;
}

export function buildTeamRowData(
  teams: readonly Team[],
  scores: readonly SeedingScore[],
  rankings: readonly SeedingRanking[],
  effectiveRounds: number,
): TeamRowData[] {
  const scoreKey = (teamId: number, round: number) => `${teamId}:${round}`;
  const scoreMap = new Map(
    scores.map((s) => [scoreKey(s.team_id, s.round_number), s]),
  );
  const rankingMap = new Map(rankings.map((r) => [r.team_id, r]));

  return teams.map((team) => ({
    team,
    scores: new Map(
      Array.from({ length: effectiveRounds }, (_, i) => {
        const round = i + 1;
        return [round, scoreMap.get(scoreKey(team.id, round)) ?? null] as const;
      }),
    ),
    ranking: rankingMap.get(team.id) ?? null,
  }));
}

/** Sort field: meta keys or `round:${n}` for round score columns */
type SortField = string;
type SortDirection = 'asc' | 'desc';
type SeedingTableVariant = 'default' | 'spectator';

function roundField(round: number): string {
  return `round:${round}`;
}

function parseRoundField(field: SortField): number | null {
  if (!field.startsWith('round:')) return null;
  const n = Number(field.slice('round:'.length));
  return Number.isFinite(n) ? n : null;
}

interface SeedingScoresTableProps {
  teamRowData: TeamRowData[];
  effectiveRounds: number;
  variant?: SeedingTableVariant;
}

export default function SeedingScoresTable({
  teamRowData,
  effectiveRounds,
  variant = 'default',
}: SeedingScoresTableProps) {
  const [sortField, setSortField] = useState<SortField>(
    variant === 'spectator' ? 'seed_rank' : 'team_number',
  );
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const isSpectator = variant === 'spectator';

  const sortedTeamRowData = useMemo(() => {
    return [...teamRowData].sort((a, b) => {
      const roundNum = parseRoundField(sortField);
      if (roundNum !== null) {
        const sa = a.scores.get(roundNum)?.score;
        const sb = b.scores.get(roundNum)?.score;
        return compareNullableNumber(sa ?? null, sb ?? null, sortDirection);
      }

      switch (sortField) {
        case 'seed_rank': {
          const ra = a.ranking?.seed_rank;
          const rb = b.ranking?.seed_rank;
          return compareNullableNumber(ra ?? null, rb ?? null, sortDirection);
        }
        case 'team_number':
          return compareNullableNumber(
            a.team.team_number,
            b.team.team_number,
            sortDirection,
          );
        case 'team_name': {
          return compareLocaleString(
            a.team.team_name,
            b.team.team_name,
            sortDirection,
          );
        }
        case 'seed_average':
          return compareNullableNumber(
            a.ranking?.seed_average ?? null,
            b.ranking?.seed_average ?? null,
            sortDirection,
          );
        case 'raw_seed_score':
          return compareNullableNumber(
            a.ranking?.raw_seed_score ?? null,
            b.ranking?.raw_seed_score ?? null,
            sortDirection,
          );
        default:
          return 0;
      }
    });
  }, [teamRowData, sortField, sortDirection]);

  const handleSort = useCallback(
    (field: string) => {
      if (sortField === field) {
        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
      } else {
        setSortField(field);
        setSortDirection('asc');
      }
    },
    [sortField, sortDirection],
  );

  const stickyRank = isSpectator ? 'sticky-col sticky-col-rank' : '';
  const stickyNum = isSpectator ? 'sticky-col sticky-col-team-number' : '';
  const stickyName = isSpectator ? 'sticky-col sticky-col-team-name' : '';

  const columns: UnifiedColumnDef<TeamRowData>[] = useMemo(() => {
    const roundCols: UnifiedColumnDef<TeamRowData>[] = Array.from(
      { length: effectiveRounds },
      (_, i) => {
        const round = i + 1;
        const rf = roundField(round);
        return {
          kind: 'data',
          id: rf,
          sortable: true,
          header: { full: `Round ${round}`, short: `R${round}` },
          headerClassName: `score-col sortable`,
          cellClassName: 'score-cell',
          title: `Round ${round}`,
          sortAriaLabel: `Sort by round ${round} score`,
          renderCell: (row) => row.scores.get(round)?.score ?? '—',
        } satisfies UnifiedColumnDef<TeamRowData>;
      },
    );

    return [
      {
        kind: 'data',
        id: 'seed_rank',
        sortable: true,
        header: { full: 'Seed Rank', short: 'Rank' },
        headerClassName: ['seed-rank-col', 'sortable', stickyRank]
          .filter(Boolean)
          .join(' '),
        cellClassName: ['rank-cell', stickyRank].filter(Boolean).join(' '),
        title: 'Seed Rank',
        sortAriaLabel: 'Sort by seed rank',
        renderCell: (row) => row.ranking?.seed_rank ?? '—',
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
        renderCell: (row) => row.team.team_number,
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
        renderCell: (row) => (
          <span className="team-name-text" title={row.team.team_name}>
            {row.team.team_name}
          </span>
        ),
      },
      ...roundCols,
      {
        kind: 'data',
        id: 'seed_average',
        sortable: true,
        header: { full: 'Seed Avg', short: 'Avg' },
        headerClassName: 'avg-col ranking-metric-col sortable',
        cellClassName: 'avg-cell',
        title: 'Seed Average',
        sortAriaLabel: 'Sort by seed average',
        renderCell: (row) =>
          row.ranking?.seed_average !== null &&
          row.ranking?.seed_average !== undefined
            ? row.ranking.seed_average.toFixed(2)
            : '—',
      },
      {
        kind: 'data',
        id: 'raw_seed_score',
        sortable: true,
        header: { full: 'Raw Seed Score', short: 'Raw' },
        headerClassName: 'ranking-metric-col raw-seed-col sortable',
        cellClassName: 'ranking-metric-cell raw-seed-cell',
        title: 'Raw Seed Score',
        sortAriaLabel: 'Sort by raw seed score',
        renderCell: (row) =>
          row.ranking?.raw_seed_score !== null &&
          row.ranking?.raw_seed_score !== undefined
            ? row.ranking.raw_seed_score.toFixed(4)
            : '—',
      },
    ];
  }, [effectiveRounds, stickyName, stickyNum, stickyRank]);

  return (
    <div
      className={`card seeding-section${isSpectator ? ' seeding-section-spectator' : ''}`}
    >
      <div className="seeding-section-header">
        <div>
          <h3>Seeding scores and rankings</h3>
          <p className="seeding-section-description">
            Per-round scores and final seed metrics. Rankings use seed averages
            (e.g. top 2 of 3 scores). Raw seed score: 75% rank position + 25%
            score ratio.
          </p>
        </div>
      </div>
      <UnifiedTable
        columns={columns}
        rows={sortedTeamRowData}
        getRowKey={(row) => row.team.id}
        activeSortId={sortField}
        sortDirection={sortDirection}
        onSort={handleSort}
        headerLabelVariant="seeding"
        wrapperClassName={`table-responsive${isSpectator ? ' seeding-table-responsive-spectator' : ''}`}
        tableClassName={`seeding-table seeding-unified-table${isSpectator ? ' seeding-table-spectator' : ''}`}
      />
    </div>
  );
}
