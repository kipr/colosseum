import React, { useCallback, useMemo, useState } from 'react';
import {
  UnifiedTable,
  compareLocaleString,
  compareNullableNumber,
} from '../table';
import type { UnifiedColumnDef } from '../table';
import type { Team } from '../seeding/SeedingScoresTable';
import '../seeding/SeedingTables.css';

export interface DoubleSeedingScore {
  id: number;
  event_id: number;
  match_id: number;
  team_id: number;
  round_number: number;
  side: 'team1' | 'team2';
  score: number | null;
  match_number: number | null;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export interface DoubleSeedingRanking {
  id: number;
  team_id: number;
  seed_average: number | null;
  seed_rank: number | null;
  raw_double_seed_score: number | null;
  tiebreaker_value: number | null;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export interface DoubleSeedingTeamRowData {
  team: Team;
  scores: Map<number, DoubleSeedingScore | null>;
  ranking: DoubleSeedingRanking | null;
}

export function buildDoubleSeedingTeamRowData(
  teams: Team[],
  scores: DoubleSeedingScore[],
  rankings: DoubleSeedingRanking[],
  effectiveRounds: number,
): DoubleSeedingTeamRowData[] {
  const scoreMap = new Map<string, DoubleSeedingScore>();
  for (const score of scores) {
    scoreMap.set(`${score.team_id}:${score.round_number}`, score);
  }

  const rankingMap = new Map<number, DoubleSeedingRanking>();
  for (const ranking of rankings) {
    rankingMap.set(ranking.team_id, ranking);
  }

  return teams.map((team) => {
    const teamScores = new Map<number, DoubleSeedingScore | null>();
    for (let round = 1; round <= effectiveRounds; round++) {
      teamScores.set(round, scoreMap.get(`${team.id}:${round}`) || null);
    }
    return {
      team,
      scores: teamScores,
      ranking: rankingMap.get(team.id) || null,
    };
  });
}

/** Sort field: meta keys or `round:${n}` for round score columns */
type SortField = string;
type SortDirection = 'asc' | 'desc';
type DoubleSeedingTableVariant = 'default' | 'spectator';

function roundField(round: number): string {
  return `round:${round}`;
}

function parseRoundField(field: SortField): number | null {
  if (!field.startsWith('round:')) return null;
  const n = Number(field.slice('round:'.length));
  return Number.isFinite(n) ? n : null;
}

interface DoubleSeedingScoresTableProps {
  teamRowData: DoubleSeedingTeamRowData[];
  effectiveRounds: number;
  variant?: DoubleSeedingTableVariant;
}

export default function DoubleSeedingScoresTable({
  teamRowData,
  effectiveRounds,
  variant = 'default',
}: DoubleSeedingScoresTableProps) {
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
        case 'raw_double_seed_score':
          return compareNullableNumber(
            a.ranking?.raw_double_seed_score ?? null,
            b.ranking?.raw_double_seed_score ?? null,
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

  const columns: UnifiedColumnDef<DoubleSeedingTeamRowData>[] = useMemo(() => {
    const roundCols: UnifiedColumnDef<DoubleSeedingTeamRowData>[] = Array.from(
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
        } satisfies UnifiedColumnDef<DoubleSeedingTeamRowData>;
      },
    );

    return [
      {
        kind: 'data',
        id: 'seed_rank',
        sortable: true,
        header: { full: 'Rank', short: 'Rank' },
        headerClassName: ['seed-rank-col', 'sortable', stickyRank]
          .filter(Boolean)
          .join(' '),
        cellClassName: ['rank-cell', stickyRank].filter(Boolean).join(' '),
        title: 'Double Seeding Rank',
        sortAriaLabel: 'Sort by double-seeding rank',
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
        header: { full: 'Average', short: 'Avg' },
        headerClassName: 'avg-col ranking-metric-col sortable',
        cellClassName: 'avg-cell',
        title: 'Double Seeding Average',
        sortAriaLabel: 'Sort by double-seeding average',
        renderCell: (row) =>
          row.ranking?.seed_average !== null &&
          row.ranking?.seed_average !== undefined
            ? row.ranking.seed_average.toFixed(2)
            : '—',
      },
      {
        kind: 'data',
        id: 'raw_double_seed_score',
        sortable: true,
        header: { full: 'Raw Double Seed Score', short: 'Raw' },
        headerClassName: 'ranking-metric-col raw-seed-col sortable',
        cellClassName: 'ranking-metric-cell raw-seed-cell',
        title: 'Raw Double Seed Score',
        sortAriaLabel: 'Sort by raw double seed score',
        renderCell: (row) =>
          row.ranking?.raw_double_seed_score !== null &&
          row.ranking?.raw_double_seed_score !== undefined
            ? row.ranking.raw_double_seed_score.toFixed(4)
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
          <h3>Double seeding scores and rankings</h3>
          <p className="seeding-section-description">
            Each team&apos;s own side score per round. Rankings use the average
            of all rounds (no rounds dropped). Raw double seed score: 2/3 rank
            position + 1/3 score ratio.
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
