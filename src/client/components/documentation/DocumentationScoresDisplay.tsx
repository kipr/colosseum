import React, { useState, useCallback, useMemo } from 'react';
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

type SortField =
  | 'team_number'
  | 'team_name'
  | 'overall_score'
  | `cat_${number}`;
type SortDirection = 'asc' | 'desc';

export default function DocumentationScoresDisplay({
  categories,
  scores,
}: DocumentationScoresDisplayProps) {
  const sortedCategories = [...categories].sort(
    (a, b) => a.ordinal - b.ordinal,
  );

  const [sortField, setSortField] = useState<SortField>('team_number');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const subScoreMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const score of scores) {
      if (score.sub_scores) {
        for (const sub of score.sub_scores) {
          map.set(`${score.team_id}-${sub.category_id}`, sub.score);
        }
      }
    }
    return map;
  }, [scores]);

  const sortedScores = useMemo(() => {
    const sorted = [...scores].sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;

      if (sortField === 'team_number') {
        aVal = a.team_number;
        bVal = b.team_number;
      } else if (sortField === 'team_name') {
        aVal = a.team_name.toLowerCase();
        bVal = b.team_name.toLowerCase();
      } else if (sortField === 'overall_score') {
        aVal = a.overall_score ?? -Infinity;
        bVal = b.overall_score ?? -Infinity;
      } else if (sortField.startsWith('cat_')) {
        const catId = parseInt(sortField.slice(4), 10);
        aVal = subScoreMap.get(`${a.team_id}-${catId}`) ?? -Infinity;
        bVal = subScoreMap.get(`${b.team_id}-${catId}`) ?? -Infinity;
      } else {
        return 0;
      }

      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [scores, subScoreMap, sortField, sortDirection]);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDirection('asc');
      }
    },
    [sortField],
  );

  const getSortIndicator = (field: SortField) =>
    sortField === field ? (sortDirection === 'asc' ? ' ▲' : ' ▼') : '';

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
                <th
                  className="doc-sortable"
                  onClick={() => handleSort('team_number')}
                >
                  Team #{getSortIndicator('team_number')}
                </th>
                <th
                  className="doc-sortable"
                  onClick={() => handleSort('team_name')}
                >
                  Team Name{getSortIndicator('team_name')}
                </th>
                {sortedCategories.map((cat, idx) => (
                  <React.Fragment key={cat.id}>
                    <th
                      className="doc-sortable"
                      title={`Max: ${cat.max_score}`}
                      onClick={() => handleSort(`cat_${cat.id}` as SortField)}
                    >
                      {cat.name} (&times;{cat.weight})
                      {getSortIndicator(`cat_${cat.id}` as SortField)}
                    </th>
                    {idx < sortedCategories.length - 1 && (
                      <th className="doc-op">+</th>
                    )}
                  </React.Fragment>
                ))}
                <th className="doc-op">=</th>
                <th
                  className="doc-sortable"
                  onClick={() => handleSort('overall_score')}
                >
                  Overall Score{getSortIndicator('overall_score')}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedScores.map((score) => (
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
