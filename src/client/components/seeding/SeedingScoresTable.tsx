import React, { useState, useCallback, useMemo } from 'react';
import './SeedingTables.css';

export interface Team {
  id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

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

export interface TeamRowData {
  team: Team;
  scores: Map<number, SeedingScore | null>;
  ranking: SeedingRanking | null;
}

export function buildTeamRowData(
  teams: Team[],
  scores: SeedingScore[],
  rankings: SeedingRanking[],
  effectiveRounds: number,
): TeamRowData[] {
  const scoreMap = new Map<string, SeedingScore>();
  for (const score of scores) {
    scoreMap.set(`${score.team_id}:${score.round_number}`, score);
  }

  const rankingMap = new Map<number, SeedingRanking>();
  for (const ranking of rankings) {
    rankingMap.set(ranking.team_id, ranking);
  }

  return teams.map((team) => {
    const teamScores = new Map<number, SeedingScore | null>();
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

function roundField(round: number): string {
  return `round:${round}`;
}

function parseRoundField(field: SortField): number | null {
  if (!field.startsWith('round:')) return null;
  const n = Number(field.slice('round:'.length));
  return Number.isFinite(n) ? n : null;
}

function compareNullableNumber(
  a: number | null | undefined,
  b: number | null | undefined,
  dir: SortDirection,
): number {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;
  if (a < b) return dir === 'asc' ? -1 : 1;
  if (a > b) return dir === 'asc' ? 1 : -1;
  return 0;
}

interface SeedingScoresTableProps {
  teamRowData: TeamRowData[];
  effectiveRounds: number;
}

export default function SeedingScoresTable({
  teamRowData,
  effectiveRounds,
}: SeedingScoresTableProps) {
  const [sortField, setSortField] = useState<SortField>('team_number');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

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
          const av = a.team.team_name.toLowerCase();
          const bv = b.team.team_name.toLowerCase();
          if (av < bv) return sortDirection === 'asc' ? -1 : 1;
          if (av > bv) return sortDirection === 'asc' ? 1 : -1;
          return 0;
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
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
      } else {
        setSortField(field);
        setSortDirection('asc');
      }
    },
    [sortField, sortDirection],
  );

  const getSortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  };

  return (
    <div className="card seeding-section">
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
      <div className="table-responsive">
        <table className="seeding-table seeding-unified-table">
          <thead>
            <tr>
              <th
                className="sortable seed-rank-col"
                onClick={() => handleSort('seed_rank')}
              >
                Seed Rank{getSortIndicator('seed_rank')}
              </th>
              <th
                className="sortable"
                onClick={() => handleSort('team_number')}
              >
                Team #{getSortIndicator('team_number')}
              </th>
              <th className="sortable" onClick={() => handleSort('team_name')}>
                Team Name{getSortIndicator('team_name')}
              </th>
              {Array.from({ length: effectiveRounds }, (_, i) => {
                const round = i + 1;
                const rf = roundField(round);
                return (
                  <th
                    key={round}
                    className="sortable score-col"
                    onClick={() => handleSort(rf)}
                  >
                    Round {round}
                    {getSortIndicator(rf)}
                  </th>
                );
              })}
              <th
                className="sortable avg-col ranking-metric-col"
                onClick={() => handleSort('seed_average')}
              >
                Seed Avg{getSortIndicator('seed_average')}
              </th>
              <th
                className="sortable ranking-metric-col"
                onClick={() => handleSort('raw_seed_score')}
              >
                Raw Seed Score{getSortIndicator('raw_seed_score')}
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedTeamRowData.map((row) => (
              <tr key={row.team.id}>
                <td className="rank-cell">{row.ranking?.seed_rank ?? '—'}</td>
                <td>{row.team.team_number}</td>
                <td>{row.team.team_name}</td>
                {Array.from({ length: effectiveRounds }, (_, i) => {
                  const round = i + 1;
                  const scoreRecord = row.scores.get(round) || null;
                  return (
                    <td key={round} className="score-cell">
                      {scoreRecord?.score ?? '—'}
                    </td>
                  );
                })}
                <td className="avg-cell">
                  {row.ranking?.seed_average !== null &&
                  row.ranking?.seed_average !== undefined
                    ? row.ranking.seed_average.toFixed(2)
                    : '—'}
                </td>
                <td className="ranking-metric-cell">
                  {row.ranking?.raw_seed_score !== null &&
                  row.ranking?.raw_seed_score !== undefined
                    ? row.ranking.raw_seed_score.toFixed(4)
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
