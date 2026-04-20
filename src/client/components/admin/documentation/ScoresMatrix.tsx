import { useCallback, useMemo, useState } from 'react';
import { UnifiedTable } from '../../table';
import type { SortDirection, UnifiedColumnDef } from '../../table/types';
import type { DocCategory, DocScore, Team } from './types';

type SortField =
  | 'team_number'
  | 'team_name'
  | 'overall_score'
  | `cat_${number}`;

type DocScoreRow = { team: Team; doc: DocScore | undefined };

interface ScoresMatrixProps {
  categories: DocCategory[];
  teams: Team[];
  scores: DocScore[];
  savingTeamId: number | null;
  inlineEdits: Record<number, Record<number, string>>;
  onCellChange: (teamId: number, categoryId: number, value: string) => void;
  onCellBlur: (team: Team) => void;
  onClearScore: (team: Team) => void;
  onOpenBulkImport: () => void;
}

/** Section B of the documentation tab: the per-team / per-category score grid. */
export function ScoresMatrix({
  categories,
  teams,
  scores,
  savingTeamId,
  inlineEdits,
  onCellChange,
  onCellBlur,
  onClearScore,
  onOpenBulkImport,
}: ScoresMatrixProps) {
  const [sortField, setSortField] = useState<SortField>('team_number');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const scoreByTeamId = useMemo(
    () => new Map(scores.map((s) => [s.team_id, s])),
    [scores],
  );
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.ordinal - b.ordinal),
    [categories],
  );

  const mergedTeams = useMemo<DocScoreRow[]>(() => {
    const merged: DocScoreRow[] = teams.map((team) => ({
      team,
      doc: scoreByTeamId.get(team.id),
    }));
    merged.sort((a, b) => {
      let aVal: string | number;
      let bVal: string | number;
      if (sortField === 'team_number') {
        aVal = a.team.team_number;
        bVal = b.team.team_number;
      } else if (sortField === 'team_name') {
        aVal = a.team.team_name.toLowerCase();
        bVal = b.team.team_name.toLowerCase();
      } else if (sortField === 'overall_score') {
        aVal = a.doc?.overall_score ?? -Infinity;
        bVal = b.doc?.overall_score ?? -Infinity;
      } else if (sortField.startsWith('cat_')) {
        const catId = parseInt(sortField.slice(4), 10);
        const subA = a.doc?.sub_scores?.find((s) => s.category_id === catId);
        const subB = b.doc?.sub_scores?.find((s) => s.category_id === catId);
        aVal = subA?.score ?? -Infinity;
        bVal = subB?.score ?? -Infinity;
      } else {
        return 0;
      }
      if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
    return merged;
  }, [teams, scoreByTeamId, sortField, sortDirection]);

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

  const getCellValue = useCallback(
    (teamId: number, categoryId: number, doc: DocScore | undefined): string => {
      const edits = inlineEdits[teamId];
      if (edits?.[categoryId] !== undefined) return edits[categoryId];
      const sub = doc?.sub_scores?.find((s) => s.category_id === categoryId);
      return sub != null ? String(sub.score) : '';
    },
    [inlineEdits],
  );

  const documentationScoreColumns = useMemo<
    UnifiedColumnDef<DocScoreRow>[]
  >(() => {
    const cols: UnifiedColumnDef<DocScoreRow>[] = [
      {
        kind: 'data',
        id: 'team_number',
        sortable: true,
        sortId: 'team_number',
        header: { full: 'Team #' },
        renderCell: ({ team }) => team.team_number,
      },
      {
        kind: 'data',
        id: 'team_name',
        sortable: true,
        sortId: 'team_name',
        header: { full: 'Team Name' },
        renderCell: ({ team }) => team.team_name,
      },
    ];

    sortedCategories.forEach((cat, idx) => {
      cols.push({
        kind: 'data',
        id: `cat_${cat.id}`,
        sortable: true,
        sortId: `cat_${cat.id}`,
        title: `Max: ${cat.max_score}`,
        header: { full: `${cat.name} (×${cat.weight})` },
        renderCell: ({ team, doc }) => (
          <span className="doc-score-cell">
            <input
              type="number"
              className="field-input doc-score-input"
              min={0}
              max={cat.max_score}
              step={0.1}
              placeholder="—"
              value={getCellValue(team.id, cat.id, doc)}
              onChange={(e) => onCellChange(team.id, cat.id, e.target.value)}
              onBlur={() => onCellBlur(team)}
              disabled={savingTeamId === team.id}
              title={`0–${cat.max_score}`}
            />
            <span className="doc-fraction">
              /{cat.max_score} ×{cat.weight}
            </span>
          </span>
        ),
      });
      if (idx < sortedCategories.length - 1) {
        cols.push({
          kind: 'separator',
          id: `plus-${cat.id}`,
          symbol: '+',
          headerClassName: 'doc-op',
          cellClassName: 'doc-op',
        });
      }
    });

    cols.push(
      {
        kind: 'separator',
        id: 'equals',
        symbol: '=',
        headerClassName: 'doc-op',
        cellClassName: 'doc-op',
      },
      {
        kind: 'data',
        id: 'overall_score',
        sortable: true,
        sortId: 'overall_score',
        header: { full: 'Overall Score' },
        renderCell: ({ doc }) =>
          doc?.overall_score != null ? (
            <strong style={{ color: 'var(--primary-color)' }}>
              {doc.overall_score.toFixed(3)}
            </strong>
          ) : (
            <em style={{ color: 'var(--secondary-color)' }}>—</em>
          ),
      },
      {
        kind: 'data',
        id: 'actions',
        sortable: false,
        header: { full: 'Actions' },
        renderCell: ({ team, doc }) =>
          doc ? (
            <button
              className="btn btn-danger"
              onClick={() => onClearScore(team)}
            >
              Clear
            </button>
          ) : null,
      },
    );

    return cols;
  }, [
    sortedCategories,
    getCellValue,
    onCellChange,
    onCellBlur,
    onClearScore,
    savingTeamId,
  ]);

  return (
    <div className="card documentation-section">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
          marginBottom: '1rem',
        }}
      >
        <h3>Team Documentation Scores</h3>
        <button
          className="btn btn-secondary"
          onClick={onOpenBulkImport}
          disabled={categories.length === 0}
        >
          Bulk Import (CSV/TSV)
        </button>
      </div>
      {categories.length === 0 ? (
        <p style={{ color: 'var(--secondary-color)' }}>
          Add categories above before entering scores.
        </p>
      ) : (
        <UnifiedTable<DocScoreRow>
          columns={documentationScoreColumns}
          rows={mergedTeams}
          getRowKey={({ team }) => team.id}
          tableClassName="doc-calculator-table"
          wrapperClassName="doc-scores-table-wrapper"
          activeSortId={sortField}
          sortDirection={sortDirection}
          onSort={(sortId) => handleSort(sortId as SortField)}
          sortableHeaderClassName="doc-sortable"
          activeSortClassName="active-sort-col"
          headerLabelVariant="none"
        />
      )}
    </div>
  );
}
