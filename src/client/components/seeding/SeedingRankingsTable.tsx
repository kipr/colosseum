import React from 'react';
import type { SeedingRanking } from './SeedingScoresTable';
import './SeedingTables.css';

interface SeedingRankingsTableProps {
  rankings: SeedingRanking[];
}

export default function SeedingRankingsTable({
  rankings,
}: SeedingRankingsTableProps) {
  return (
    <div className="card seeding-section">
      <div className="seeding-section-header">
        <div>
          <h3>Rankings</h3>
          <p className="seeding-section-description">
            Final rankings ordered by raw seed score. Formula: 75% rank position
            + 25% score ratio (top 2 of 3 scores).
          </p>
        </div>
      </div>
      <div className="table-responsive">
        <table className="seeding-table rankings-table">
          <thead>
            <tr>
              <th>Seed Rank</th>
              <th>Team #</th>
              <th>Team Name</th>
              <th>Seed Average</th>
              <th>Raw Seed Score</th>
              <th>Tiebreaker</th>
            </tr>
          </thead>
          <tbody>
            {rankings.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  style={{
                    textAlign: 'center',
                    color: 'var(--secondary-color)',
                  }}
                >
                  No rankings calculated yet.
                </td>
              </tr>
            ) : (
              [...rankings]
                .sort((a, b) => {
                  const aRank = a.seed_rank ?? Infinity;
                  const bRank = b.seed_rank ?? Infinity;
                  return aRank - bRank;
                })
                .map((ranking) => (
                  <tr key={ranking.team_id}>
                    <td className="rank-cell">{ranking.seed_rank ?? '—'}</td>
                    <td>{ranking.team_number}</td>
                    <td>{ranking.team_name}</td>
                    <td>
                      {ranking.seed_average !== null
                        ? ranking.seed_average.toFixed(2)
                        : '—'}
                    </td>
                    <td>
                      {ranking.raw_seed_score !== null
                        ? ranking.raw_seed_score.toFixed(4)
                        : '—'}
                    </td>
                    <td>
                      {ranking.tiebreaker_value !== null
                        ? ranking.tiebreaker_value.toFixed(2)
                        : '—'}
                    </td>
                  </tr>
                ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
