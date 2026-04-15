import React, { useCallback, useMemo, useState } from 'react';
import { UnifiedTable } from '../table';
import type { UnifiedColumnDef } from '../table';
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
  variant?: 'default' | 'spectator';
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
  variant = 'default',
}: DocumentationScoresDisplayProps) {
  const isSpectator = variant === 'spectator';
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
    (field: string) => {
      const f = field as SortField;
      if (sortField === f) {
        setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(f);
        setSortDirection('asc');
      }
    },
    [sortField],
  );

  const stickyNum = isSpectator
    ? 'sticky-col sticky-col-team-number doc-team-number-col'
    : '';
  const stickyName = isSpectator
    ? 'sticky-col sticky-col-team-name doc-team-name-col'
    : '';
  const stickyNumCell = isSpectator
    ? 'sticky-col sticky-col-team-number doc-team-number-cell'
    : '';
  const stickyNameCell = isSpectator
    ? 'sticky-col sticky-col-team-name doc-team-name-cell'
    : '';

  const columns: UnifiedColumnDef<DocScoreDisplay>[] = useMemo(() => {
    const base: UnifiedColumnDef<DocScoreDisplay>[] = [
      {
        kind: 'data',
        id: 'team_number',
        sortable: true,
        header: { full: 'Team #', short: '#' },
        headerClassName: ['doc-sortable', stickyNum].filter(Boolean).join(' '),
        cellClassName: stickyNumCell,
        sortAriaLabel: 'Sort by team number',
        renderCell: (score) => score.team_number,
      },
      {
        kind: 'data',
        id: 'team_name',
        sortable: true,
        header: { full: 'Team Name', short: 'Name' },
        headerClassName: ['doc-sortable', stickyName].filter(Boolean).join(' '),
        cellClassName: stickyNameCell,
        sortAriaLabel: 'Sort by team name',
        renderCell: (score) => (
          <span
            className="doc-team-name-text"
            title={score.team_name || undefined}
          >
            {score.team_name}
          </span>
        ),
      },
    ];

    sortedCategories.forEach((cat, idx) => {
      const sf = `cat_${cat.id}` as SortField;
      base.push({
        kind: 'data',
        id: sf,
        sortId: sf,
        sortable: true,
        header: {
          full: `${cat.name} (×${cat.weight})`,
          short: `C${cat.ordinal}`,
        },
        headerClassName: 'doc-category-col doc-sortable',
        cellClassName: 'doc-category-cell',
        title: `Max: ${cat.max_score}`,
        sortAriaLabel: `Sort by ${cat.name}`,
        renderCell: (score) => {
          const val = subScoreMap.get(`${score.team_id}-${cat.id}`);
          return val != null ? (
            <span>
              {val}/{cat.max_score}
            </span>
          ) : (
            <em style={{ color: 'var(--secondary-color)' }}>—</em>
          );
        },
      });
      if (idx < sortedCategories.length - 1) {
        base.push({
          kind: 'separator',
          id: `sep-plus-${cat.id}`,
          symbol: '+',
        });
      }
    });

    base.push({
      kind: 'separator',
      id: 'sep-eq',
      symbol: '=',
    });

    base.push({
      kind: 'data',
      id: 'overall_score',
      sortable: true,
      header: { full: 'Overall Score', short: 'Total' },
      headerClassName: 'doc-overall-col doc-sortable',
      cellClassName: 'doc-overall-cell',
      sortAriaLabel: 'Sort by overall score',
      renderCell: (score) =>
        score.overall_score != null ? (
          <strong style={{ color: 'var(--primary-color)' }}>
            {score.overall_score.toFixed(3)}
          </strong>
        ) : (
          <em style={{ color: 'var(--secondary-color)' }}>—</em>
        ),
    });

    return base;
  }, [
    sortedCategories,
    stickyName,
    stickyNameCell,
    stickyNum,
    stickyNumCell,
    subScoreMap,
  ]);

  if (categories.length === 0) {
    return (
      <div
        className={`card documentation-section${isSpectator ? ' documentation-section-spectator' : ''}`}
      >
        <h3>Documentation Scores</h3>
        <p style={{ color: 'var(--secondary-color)' }}>
          No documentation categories configured.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`card documentation-section${isSpectator ? ' documentation-section-spectator' : ''}`}
    >
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
        <div
          className={`doc-scores-table-wrapper${isSpectator ? ' doc-scores-table-wrapper-spectator' : ''}`}
        >
          <UnifiedTable
            columns={columns}
            rows={sortedScores}
            getRowKey={(s) => s.team_id}
            activeSortId={sortField}
            sortDirection={sortDirection}
            onSort={handleSort}
            headerLabelVariant="doc"
            tableClassName={`doc-calculator-table${isSpectator ? ' doc-calculator-table-spectator' : ''}`}
          />
        </div>
      )}
    </div>
  );
}
