import React from 'react';
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
}

function formatScore(val: number): string {
  return val.toFixed(4);
}

export default function OverallScoresDisplay({
  rows,
}: OverallScoresDisplayProps) {
  const sortedRows = [...rows].sort((a, b) => b.total - a.total);

  return (
    <div className="card documentation-section">
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
        <div className="doc-scores-table-wrapper">
          <table className="doc-calculator-table">
            <thead>
              <tr>
                <th>Team #</th>
                <th>Team Name</th>
                <th>Doc Score</th>
                <th className="doc-op">+</th>
                <th>Raw Seeding</th>
                <th className="doc-op">+</th>
                <th>Weighted DE</th>
                <th className="doc-op">=</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.team_id}>
                  <td>{row.team_number}</td>
                  <td>{row.team_name}</td>
                  <td>{formatScore(row.doc_score)}</td>
                  <td className="doc-op">+</td>
                  <td>{formatScore(row.raw_seed_score)}</td>
                  <td className="doc-op">+</td>
                  <td>{formatScore(row.weighted_de_score)}</td>
                  <td className="doc-op">=</td>
                  <td>
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
