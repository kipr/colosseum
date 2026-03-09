import React from 'react';
import '../admin/DocumentationTab.css';

export interface DocCategoryDisplay {
  id: number;
  name: string;
  weight: number;
  max_score: number;
  ordinal: number;
}

export interface DocSubScoreDisplay {
  category_id: number;
  category_name: string;
  ordinal: number;
  max_score: number;
  weight: number;
  score: number;
}

export interface DocScoreDisplay {
  team_id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
  overall_score: number | null;
  sub_scores?: DocSubScoreDisplay[];
}

interface DocumentationScoresDisplayProps {
  categories: DocCategoryDisplay[];
  scores: DocScoreDisplay[];
}

export default function DocumentationScoresDisplay({
  categories,
  scores,
}: DocumentationScoresDisplayProps) {
  const sortedCategories = [...categories].sort(
    (a, b) => a.ordinal - b.ordinal,
  );

  if (categories.length === 0) {
    return (
      <div className="card documentation-section">
        <h3>Documentation Scores</h3>
        <p style={{ color: 'var(--secondary-color)' }}>
          No documentation categories configured.
        </p>
      </div>
    );
  }

  const subScoreMap = new Map<string, number>();
  for (const score of scores) {
    if (score.sub_scores) {
      for (const sub of score.sub_scores) {
        subScoreMap.set(`${score.team_id}-${sub.category_id}`, sub.score);
      }
    }
  }

  return (
    <div className="card documentation-section">
      <h3>Documentation Scores</h3>
      <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
        Combined score per team: sum of (score / max) &times; weight per
        category.
      </p>
      {scores.length === 0 ? (
        <p style={{ color: 'var(--secondary-color)' }}>
          No documentation scores recorded yet.
        </p>
      ) : (
        <div className="doc-scores-table-wrapper">
          <table className="doc-calculator-table">
            <thead>
              <tr>
                <th>Team #</th>
                <th>Team Name</th>
                {sortedCategories.map((cat, idx) => (
                  <React.Fragment key={cat.id}>
                    <th title={`Max: ${cat.max_score}`}>
                      {cat.name} (&times;{cat.weight})
                    </th>
                    {idx < sortedCategories.length - 1 && (
                      <th className="doc-op">+</th>
                    )}
                  </React.Fragment>
                ))}
                <th className="doc-op">=</th>
                <th>Overall Score</th>
              </tr>
            </thead>
            <tbody>
              {scores.map((score) => (
                <tr key={score.team_id}>
                  <td>{score.team_number}</td>
                  <td>{score.team_name}</td>
                  {sortedCategories.map((cat, idx) => {
                    const val = subScoreMap.get(`${score.team_id}-${cat.id}`);
                    return (
                      <React.Fragment key={cat.id}>
                        <td>
                          {val != null ? (
                            <span>
                              {val}/{cat.max_score}
                            </span>
                          ) : (
                            <em style={{ color: 'var(--secondary-color)' }}>
                              —
                            </em>
                          )}
                        </td>
                        {idx < sortedCategories.length - 1 && (
                          <td className="doc-op">+</td>
                        )}
                      </React.Fragment>
                    );
                  })}
                  <td className="doc-op">=</td>
                  <td>
                    {score.overall_score != null ? (
                      <strong style={{ color: 'var(--primary-color)' }}>
                        {score.overall_score.toFixed(3)}
                      </strong>
                    ) : (
                      <em style={{ color: 'var(--secondary-color)' }}>—</em>
                    )}
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
