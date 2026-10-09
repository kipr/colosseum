import { useMemo } from 'react';
import {
  compareLocaleString,
  compareNullableNumber,
  compareValues,
  UnifiedTable,
  useTableSort,
} from '../table';
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

const META_SORT_FIELDS = ['team_number', 'team_name', 'overall_score'] as const;
/** Sort ids shared by the public and admin documentation tables. */
export type DocumentationSortField =
  | (typeof META_SORT_FIELDS)[number]
  | `cat_${number}`;
type SortField = DocumentationSortField;

export function isDocumentationSortField(
  sortId: string,
): sortId is DocumentationSortField {
  return (
    (META_SORT_FIELDS as readonly string[]).includes(sortId) ||
    /^cat_\d+$/.test(sortId)
  );
}

export default function DocumentationScoresDisplay({
  categories,
  scores,
  variant = 'default',
}: DocumentationScoresDisplayProps) {
  const isSpectator = variant === 'spectator';
  const sortedCategories = [...categories].sort(
    (a, b) => a.ordinal - b.ordinal,
  );

  const { sortField, sortDirection, onSort } = useTableSort<SortField>({
    initialField: 'team_number',
    fields: isDocumentationSortField,
  });

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
      switch (sortField) {
        case 'team_number':
          return compareValues(a.team_number, b.team_number, sortDirection);
        case 'team_name':
          return compareLocaleString(a.team_name, b.team_name, sortDirection);
        case 'overall_score':
          return compareNullableNumber(
            a.overall_score,
            b.overall_score,
            sortDirection,
          );
        default: {
          const catId = parseInt(sortField.slice('cat_'.length), 10);
          return compareNullableNumber(
            subScoreMap.get(`${a.team_id}-${catId}`),
            subScoreMap.get(`${b.team_id}-${catId}`),
            sortDirection,
          );
        }
      }
    });
    return sorted;
  }, [scores, subScoreMap, sortField, sortDirection]);

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
        <UnifiedTable
          columns={columns}
          rows={sortedScores}
          getRowKey={(s) => s.team_id}
          activeSortId={sortField}
          sortDirection={sortDirection}
          onSort={onSort}
          headerLabelVariant="doc"
          wrapperClassName={`doc-scores-table-wrapper${isSpectator ? ' doc-scores-table-wrapper-spectator' : ''}`}
          tableClassName={`doc-calculator-table${isSpectator ? ' doc-calculator-table-spectator' : ''}`}
        />
      )}
    </div>
  );
}
