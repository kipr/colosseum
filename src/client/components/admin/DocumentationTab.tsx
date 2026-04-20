import { useMemo, useState } from 'react';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import { apiSend } from '../../utils/apiClient';
import {
  buildBulkImportSubScores,
  parseDocScoresText,
} from './documentationBulkImport';
import { useDocumentationScores } from './documentation/useDocumentationScores';
import { CategoryTable } from './documentation/CategoryTable';
import { CategoryModal } from './documentation/CategoryModal';
import { BulkImportModal } from './documentation/BulkImportModal';
import { ScoresMatrix } from './documentation/ScoresMatrix';
import type { DocCategory, Team } from './documentation/types';
import '../Modal.css';
import './DocumentationTab.css';

export default function DocumentationTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  const {
    categories,
    globalCategories,
    teams,
    scores,
    loading,
    refetchCategories,
    refetchScores,
  } = useDocumentationScores(selectedEventId, toast.error);

  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<DocCategory | null>(
    null,
  );
  const [savingCategory, setSavingCategory] = useState(false);

  const [inlineEdits, setInlineEdits] = useState<
    Record<number, Record<number, string>>
  >({});
  const [savingTeamId, setSavingTeamId] = useState<number | null>(null);

  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResults, setBulkResults] = useState<{
    success: number;
    errors: { index: number; error: string }[];
  } | null>(null);

  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => a.ordinal - b.ordinal),
    [categories],
  );
  const scoreByTeamId = useMemo(
    () => new Map(scores.map((s) => [s.team_id, s])),
    [scores],
  );
  const teamByNumber = useMemo(
    () => new Map(teams.map((t) => [t.team_number, t])),
    [teams],
  );

  if (!selectedEventId) {
    return (
      <div className="documentation-tab">
        <div className="card">
          <p style={{ color: 'var(--secondary-color)' }}>
            Select an event to manage documentation scores.
          </p>
        </div>
      </div>
    );
  }

  const handleSaveCategory = async (input: {
    editing: DocCategory | null;
    mode: 'create' | 'link';
    form: { ordinal: string; name: string; weight: string; max_score: string };
    selectedGlobalCategoryId: number | null;
  }) => {
    const ord = parseInt(input.form.ordinal, 10);
    if (isNaN(ord) || ord < 1 || ord > 4) {
      toast.error('Ordinal must be between 1 and 4');
      return;
    }

    const isLink =
      !input.editing && input.mode === 'link' && input.selectedGlobalCategoryId;
    const isCreateNew = !input.editing && input.mode === 'create';

    if (input.mode === 'link' && !input.selectedGlobalCategoryId) {
      toast.error('Select a category to link');
      return;
    }

    if (isCreateNew) {
      const weight = parseFloat(input.form.weight);
      const maxScore = parseFloat(input.form.max_score);
      if (!input.form.name.trim()) {
        toast.error('Name is required');
        return;
      }
      if (isNaN(weight) || weight < 0) {
        toast.error('Weight must be non-negative');
        return;
      }
      if (isNaN(maxScore) || maxScore <= 0) {
        toast.error('Max score must be a positive number');
        return;
      }
    }

    setSavingCategory(true);
    try {
      if (input.editing) {
        await apiSend(
          'PATCH',
          `/documentation-scores/categories/${input.editing.id}?event_id=${selectedEventId}`,
          { ordinal: ord },
        );
        toast.success('Category updated!');
      } else if (isLink) {
        await apiSend('POST', '/documentation-scores/categories', {
          event_id: selectedEventId,
          ordinal: ord,
          category_id: input.selectedGlobalCategoryId,
        });
        toast.success('Category linked!');
      } else if (isCreateNew) {
        const weight = parseFloat(input.form.weight);
        const maxScore = parseFloat(input.form.max_score);
        await apiSend('POST', '/documentation-scores/categories', {
          event_id: selectedEventId,
          ordinal: ord,
          name: input.form.name.trim(),
          weight,
          max_score: maxScore,
        });
        toast.success('Category created!');
      }
      setShowCategoryModal(false);
      setEditingCategory(null);
      await refetchCategories();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save category',
      );
    } finally {
      setSavingCategory(false);
    }
  };

  const handleDeleteCategory = async (cat: DocCategory) => {
    const ok = await confirm({
      title: 'Remove Category',
      message: `Remove "${cat.name}" from this event?`,
      confirmText: 'Remove',
      confirmStyle: 'danger',
    });
    if (!ok) return;
    try {
      await apiSend(
        'DELETE',
        `/documentation-scores/categories/${cat.id}?event_id=${selectedEventId}`,
      );
      toast.success('Category removed');
      await refetchCategories();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to remove category',
      );
    }
  };

  const handleCellChange = (
    teamId: number,
    categoryId: number,
    value: string,
  ) => {
    setInlineEdits((prev) => ({
      ...prev,
      [teamId]: {
        ...(prev[teamId] ?? {}),
        [categoryId]: value,
      },
    }));
  };

  const handleCellBlur = async (team: Team) => {
    const doc = scoreByTeamId.get(team.id);
    const edits = inlineEdits[team.id] ?? {};

    const sub_scores: { category_id: number; score: number }[] = [];
    for (const cat of sortedCategories) {
      const val =
        edits[cat.id] ??
        doc?.sub_scores?.find((s) => s.category_id === cat.id)?.score;
      if (val === undefined || val === '' || val == null) continue;
      const score = typeof val === 'string' ? parseFloat(val) : val;
      if (!Number.isFinite(score) || score < 0 || score > cat.max_score) {
        toast.error(`"${cat.name}" must be between 0 and ${cat.max_score}`);
        return;
      }
      sub_scores.push({ category_id: cat.id, score });
    }

    if (sub_scores.length === 0) return;

    setSavingTeamId(team.id);
    try {
      await apiSend(
        'PUT',
        `/documentation-scores/event/${selectedEventId}/team/${team.id}`,
        { sub_scores },
      );
      toast.success('Score saved!');
      setInlineEdits((prev) => {
        const next = { ...prev };
        delete next[team.id];
        return next;
      });
      await refetchScores();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save score');
    } finally {
      setSavingTeamId(null);
    }
  };

  const handleClearScore = async (team: Team) => {
    const ok = await confirm({
      title: 'Clear Score',
      message: `Clear documentation score for team ${team.team_number}?`,
      confirmText: 'Clear',
      confirmStyle: 'danger',
    });
    if (!ok) return;
    try {
      await apiSend(
        'DELETE',
        `/documentation-scores/event/${selectedEventId}/team/${team.id}`,
      );
      toast.success('Score cleared');
      await refetchScores();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear score');
    }
  };

  const handleBulkImport = async (input: {
    bulkText: string;
    selectedCategoryId: string;
    parsed: { team_number: number; scores: number[] }[];
  }) => {
    if (input.parsed.length === 0 || !selectedEventId) return;

    const selectedBulkCategory =
      sortedCategories.find(
        (cat) => String(cat.id) === input.selectedCategoryId,
      ) ?? null;

    // Re-parse to validate against the actual category set used during import.
    const expectedCols = selectedBulkCategory ? 1 : sortedCategories.length;
    const { errors: parseErrors } = parseDocScoresText(
      input.bulkText,
      expectedCols,
    );
    if (parseErrors.length > 0) {
      toast.error('Fix parse errors before importing');
      return;
    }

    setBulkImporting(true);
    setBulkResults(null);
    const errors: { index: number; error: string }[] = [];
    let success = 0;

    for (let i = 0; i < input.parsed.length; i++) {
      const row = input.parsed[i];
      const team = teamByNumber.get(row.team_number);
      if (!team) {
        errors.push({ index: i, error: `Team ${row.team_number} not found` });
        continue;
      }

      const existingDoc = scoreByTeamId.get(team.id);
      const sub_scores = buildBulkImportSubScores({
        categories: sortedCategories,
        rowScores: row.scores,
        selectedCategoryId: selectedBulkCategory?.id ?? null,
        existingSubScores: existingDoc?.sub_scores?.map((subScore) => ({
          category_id: subScore.category_id,
          score: subScore.score,
        })),
      });

      try {
        await apiSend(
          'PUT',
          `/documentation-scores/event/${selectedEventId}/team/${team.id}`,
          { sub_scores },
        );
        success++;
      } catch (err) {
        errors.push({
          index: i,
          error:
            err instanceof Error && err.message
              ? `Team ${row.team_number}: ${err.message}`
              : `Team ${row.team_number}: request failed`,
        });
      }
    }

    setBulkResults({ success, errors });
    if (success > 0) {
      toast.success(`Imported ${success} score(s)`);
      await refetchScores();
    }
    if (errors.length > 0) {
      toast.warning(`${errors.length} row(s) failed`);
    }
    setBulkImporting(false);
  };

  return (
    <div className="documentation-tab">
      {loading && <p style={{ color: 'var(--secondary-color)' }}>Loading...</p>}

      <CategoryTable
        categories={categories}
        onAdd={() => {
          setEditingCategory(null);
          setShowCategoryModal(true);
        }}
        onEdit={(cat) => {
          setEditingCategory(cat);
          setShowCategoryModal(true);
        }}
        onDelete={handleDeleteCategory}
      />

      <ScoresMatrix
        categories={categories}
        teams={teams}
        scores={scores}
        savingTeamId={savingTeamId}
        inlineEdits={inlineEdits}
        onCellChange={handleCellChange}
        onCellBlur={handleCellBlur}
        onClearScore={handleClearScore}
        onOpenBulkImport={() => {
          setBulkResults(null);
          setShowBulkImport(true);
        }}
      />

      <CategoryModal
        open={showCategoryModal}
        editingCategory={editingCategory}
        globalCategories={globalCategories}
        existingCategories={categories}
        saving={savingCategory}
        onClose={() => {
          setShowCategoryModal(false);
          setEditingCategory(null);
        }}
        onSubmit={handleSaveCategory}
      />

      <BulkImportModal
        open={showBulkImport}
        categories={categories}
        importing={bulkImporting}
        results={bulkResults}
        onClose={() => {
          setShowBulkImport(false);
          setBulkResults(null);
        }}
        onImport={handleBulkImport}
      />

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
