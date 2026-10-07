import { useCallback, useMemo, useState } from 'react';
import {
  UnifiedTable,
  compareLocaleString,
  compareNullableNumber,
} from '../table';
import type { UnifiedColumnDef } from '../table';
import type { TeamSummary } from '../../types/teams';
import './SeedingTables.css';

export interface SeedingScore {
  id: number;
  team_id: number;
  round_number: number;
  score: number | null;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

export interface SeedingRanking {
  id: number;
  team_id: number;
  seed_average: number | null;
  seed_rank: number | null;
  raw_seed_score: number | null;
  tiebreaker_value: number | null;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

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

/** Fields the table reads from a per-round score. */
export interface RoundScore {
  team_id: number;
  round_number: number;
  score: number | null;
}

/** Fields the table reads from a ranking, apart from the raw score. */
export interface RankingBase {
  team_id: number;
  seed_rank: number | null;
  seed_average: number | null;
}

interface ColumnLabels {
  full: string;
  title: string;
  sortAriaLabel: string;
}

/** What differs between the seeding and double-seeding tables. */
export interface SeedingTableConfig<R extends RankingBase> {
  rawScore: (ranking: R) => number | null;
  heading: string;
  description: string;
  rank: ColumnLabels;
  average: ColumnLabels;
  raw: ColumnLabels;
}

export const SEEDING_TABLE_CONFIG: SeedingTableConfig<SeedingRanking> = {
  rawScore: (ranking) => ranking.raw_seed_score,
  heading: 'Seeding scores and rankings',
  description:
    "Per-round scores and final seed metrics. Rankings use seed averages (e.g. top 2 of 3 scores). Raw seed score: 75% rank position + 25% score ratio against the event's best single round.",
  rank: {
    full: 'Seed Rank',
    title: 'Seed Rank',
    sortAriaLabel: 'Sort by seed rank',
  },
  average: {
    full: 'Seed Avg',
    title: 'Seed Average',
    sortAriaLabel: 'Sort by seed average',
  },
  raw: {
    full: 'Raw Seed Score',
    title: 'Raw Seed Score',
    sortAriaLabel: 'Sort by raw seed score',
  },
};

export const DOUBLE_SEEDING_TABLE_CONFIG: SeedingTableConfig<DoubleSeedingRanking> =
  {
    rawScore: (ranking) => ranking.raw_double_seed_score,
    heading: 'Double seeding scores and rankings',
    description:
      "Each team's own side score per round. Rankings use the average of all rounds (no rounds dropped). Raw double seed score: 2/3 rank position + 1/3 score ratio against the event's best single round.",
    rank: {
      full: 'Rank',
      title: 'Double Seeding Rank',
      sortAriaLabel: 'Sort by double-seeding rank',
    },
    average: {
      full: 'Average',
      title: 'Double Seeding Average',
      sortAriaLabel: 'Sort by double-seeding average',
    },
    raw: {
      full: 'Raw Double Seed Score',
      title: 'Raw Double Seed Score',
      sortAriaLabel: 'Sort by raw double seed score',
    },
  };

export interface TeamRowData<S extends RoundScore, R extends RankingBase> {
  team: TeamSummary;
  scores: Map<number, S | null>;
  ranking: R | null;
}

export function buildTeamRowData<S extends RoundScore, R extends RankingBase>(
  teams: TeamSummary[],
  scores: S[],
  rankings: R[],
  effectiveRounds: number,
): TeamRowData<S, R>[] {
  const scoreMap = new Map<string, S>();
  for (const score of scores) {
    scoreMap.set(`${score.team_id}:${score.round_number}`, score);
  }

  const rankingMap = new Map<number, R>();
  for (const ranking of rankings) {
    rankingMap.set(ranking.team_id, ranking);
  }

  return teams.map((team) => {
    const teamScores = new Map<number, S | null>();
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
type SeedingTableVariant = 'default' | 'spectator';

function roundField(round: number): string {
  return `round:${round}`;
}

function parseRoundField(field: SortField): number | null {
  if (!field.startsWith('round:')) return null;
  const n = Number(field.slice('round:'.length));
  return Number.isFinite(n) ? n : null;
}

interface SeedingScoresTableProps<S extends RoundScore, R extends RankingBase> {
  teamRowData: TeamRowData<S, R>[];
  effectiveRounds: number;
  config: SeedingTableConfig<R>;
  variant?: SeedingTableVariant;
}

export default function SeedingScoresTable<
  S extends RoundScore,
  R extends RankingBase,
>({
  teamRowData,
  effectiveRounds,
  config,
  variant = 'default',
}: SeedingScoresTableProps<S, R>) {
  type Row = TeamRowData<S, R>;
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
        case 'raw_score':
          return compareNullableNumber(
            a.ranking ? config.rawScore(a.ranking) : null,
            b.ranking ? config.rawScore(b.ranking) : null,
            sortDirection,
          );
        default:
          return 0;
      }
    });
  }, [teamRowData, sortField, sortDirection, config]);

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

  const columns: UnifiedColumnDef<Row>[] = useMemo(() => {
    const roundCols: UnifiedColumnDef<Row>[] = Array.from(
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
        } satisfies UnifiedColumnDef<Row>;
      },
    );

    return [
      {
        kind: 'data',
        id: 'seed_rank',
        sortable: true,
        header: { full: config.rank.full, short: 'Rank' },
        headerClassName: ['seed-rank-col', 'sortable', stickyRank]
          .filter(Boolean)
          .join(' '),
        cellClassName: ['rank-cell', stickyRank].filter(Boolean).join(' '),
        title: config.rank.title,
        sortAriaLabel: config.rank.sortAriaLabel,
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
        header: { full: config.average.full, short: 'Avg' },
        headerClassName: 'avg-col ranking-metric-col sortable',
        cellClassName: 'avg-cell',
        title: config.average.title,
        sortAriaLabel: config.average.sortAriaLabel,
        renderCell: (row) =>
          row.ranking?.seed_average !== null &&
          row.ranking?.seed_average !== undefined
            ? row.ranking.seed_average.toFixed(2)
            : '—',
      },
      {
        kind: 'data',
        id: 'raw_score',
        sortable: true,
        header: { full: config.raw.full, short: 'Raw' },
        headerClassName: 'ranking-metric-col raw-seed-col sortable',
        cellClassName: 'ranking-metric-cell raw-seed-cell',
        title: config.raw.title,
        sortAriaLabel: config.raw.sortAriaLabel,
        renderCell: (row) => {
          const raw = row.ranking ? config.rawScore(row.ranking) : null;
          return raw !== null && raw !== undefined ? raw.toFixed(4) : '—';
        },
      },
    ];
  }, [effectiveRounds, stickyName, stickyNum, stickyRank, config]);

  return (
    <div
      className={`card seeding-section${isSpectator ? ' seeding-section-spectator' : ''}`}
    >
      <div className="seeding-section-header">
        <div>
          <h3>{config.heading}</h3>
          <p className="seeding-section-description">{config.description}</p>
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
