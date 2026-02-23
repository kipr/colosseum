import React, { useState, useCallback } from 'react';
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

type SortField = 'team_number' | 'team_name';
type SortDirection = 'asc' | 'desc';

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

  const sortedTeamRowData = [...teamRowData].sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;

    if (sortField === 'team_number') {
      aVal = a.team.team_number;
      bVal = b.team.team_number;
    } else {
      aVal = a.team.team_name.toLowerCase();
      bVal = b.team.team_name.toLowerCase();
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

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
          <h3>Seeding Scores</h3>
          <p className="seeding-section-description">
            Seeding scores for each team and round.
          </p>
        </div>
      </div>
      <div className="table-responsive">
        <table className="seeding-table">
          <thead>
            <tr>
              <th
                className="sortable"
                onClick={() => handleSort('team_number')}
              >
                Team #{getSortIndicator('team_number')}
              </th>
              <th className="sortable" onClick={() => handleSort('team_name')}>
                Team Name{getSortIndicator('team_name')}
              </th>
              {Array.from({ length: effectiveRounds }, (_, i) => (
                <th key={i + 1} className="score-col">
                  Round {i + 1}
                </th>
              ))}
              <th className="avg-col">Seed Avg</th>
            </tr>
          </thead>
          <tbody>
            {sortedTeamRowData.map((row) => (
              <tr key={row.team.id}>
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
