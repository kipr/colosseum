import React, { useState, useEffect, useCallback } from 'react';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import { formatDateTime } from '../../utils/dateUtils';
import '../Modal.css';
import './DocumentationTab.css';

interface DocCategory {
  id: number;
  event_id: number;
  ordinal: number;
  name: string;
  weight: number;
  max_score: number;
}

interface DocSubScore {
  category_id: number;
  category_name: string;
  ordinal: number;
  max_score: number;
  weight: number;
  score: number;
}

interface DocScore {
  id: number;
  event_id: number;
  team_id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
  overall_score: number | null;
  scored_at: string | null;
  sub_scores?: DocSubScore[];
}

interface Team {
  id: number;
  event_id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

interface CategoryFormData {
  ordinal: string;
  name: string;
  weight: string;
  max_score: string;
}

const defaultCategoryForm: CategoryFormData = {
  ordinal: '1',
  name: '',
  weight: '1',
  max_score: '',
};

interface ParsedDocRow {
  team_number: number;
  scores: number[];
}

function parseDocScoresText(
  text: string,
  categoryCount: number,
): { rows: ParsedDocRow[]; errors: string[] } {
  const lines = text
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const rows: ParsedDocRow[] = [];
  const errors: string[] = [];
  const expectedCols = 1 + categoryCount;

  let startIndex = 0;
  if (lines.length > 0) {
    const first = lines[0];
    const delim = first.includes('\t') ? '\t' : ',';
    const firstParts = first.split(delim).map((p) => p.trim());
    const firstCol = firstParts[0];
    if (
      firstCol &&
      firstCol.length > 0 &&
      !/^\d+$/.test(firstCol) &&
      isNaN(parseInt(firstCol, 10))
    ) {
      startIndex = 1;
    }
  }

  for (let i = startIndex; i < lines.length; i++) {
    const line = lines[i];
    const delim = line.includes('\t') ? '\t' : ',';
    const parts = line.split(delim).map((p) => p.trim());

    if (parts.length !== expectedCols) {
      errors.push(
        `Line ${i + 1}: Expected ${expectedCols} columns, got ${parts.length}`,
      );
      continue;
    }

    const teamNumber = parseInt(parts[0], 10);
    if (isNaN(teamNumber) || teamNumber <= 0) {
      errors.push(`Line ${i + 1}: Invalid team number "${parts[0]}"`);
      continue;
    }

    const scores: number[] = [];
    let rowError = false;
    for (let c = 1; c < parts.length; c++) {
      const val = parseFloat(parts[c]);
      if (!Number.isFinite(val) || val < 0) {
        errors.push(`Line ${i + 1}, col ${c + 1}: Invalid score "${parts[c]}"`);
        rowError = true;
        break;
      }
      scores.push(val);
    }
    if (!rowError) {
      rows.push({ team_number: teamNumber, scores });
    }
  }

  return { rows, errors };
}

export default function DocumentationTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;

  const [categories, setCategories] = useState<DocCategory[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<DocScore[]>([]);
  const [loading, setLoading] = useState(false);

  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<DocCategory | null>(
    null,
  );
  const [categoryForm, setCategoryForm] =
    useState<CategoryFormData>(defaultCategoryForm);
  const [savingCategory, setSavingCategory] = useState(false);

  const [showScoreModal, setShowScoreModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState<Team | null>(null);
  const [scoreForm, setScoreForm] = useState<Record<number, string>>({});
  const [savingScore, setSavingScore] = useState(false);

  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResults, setBulkResults] = useState<{
    success: number;
    errors: { index: number; error: string }[];
  } | null>(null);

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  const fetchCategories = useCallback(async () => {
    if (!selectedEventId) {
      setCategories([]);
      return;
    }
    try {
      const res = await fetch(
        `/documentation-scores/categories/event/${selectedEventId}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to fetch categories');
      const data: DocCategory[] = await res.json();
      setCategories(data);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load categories');
    }
  }, [selectedEventId]);

  const fetchTeams = useCallback(async () => {
    if (!selectedEventId) {
      setTeams([]);
      return;
    }
    try {
      const res = await fetch(`/teams/event/${selectedEventId}`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch teams');
      const data: Team[] = await res.json();
      setTeams(data);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load teams');
    }
  }, [selectedEventId]);

  const fetchScores = useCallback(async () => {
    if (!selectedEventId) {
      setScores([]);
      return;
    }
    try {
      const res = await fetch(
        `/documentation-scores/event/${selectedEventId}`,
        { credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to fetch scores');
      const data: DocScore[] = await res.json();
      setScores(data);
    } catch (err) {
      console.error(err);
      toast.error('Failed to load documentation scores');
    }
  }, [selectedEventId]);

  const loadAll = useCallback(() => {
    setLoading(true);
    Promise.all([fetchCategories(), fetchTeams(), fetchScores()]).finally(() =>
      setLoading(false),
    );
  }, [fetchCategories, fetchTeams, fetchScores]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const scoreByTeamId = new Map(scores.map((s) => [s.team_id, s]));
  const teamByNumber = new Map(teams.map((t) => [t.team_number, t]));

  const mergedTeams = teams.map((team) => {
    const doc = scoreByTeamId.get(team.id);
    return {
      team,
      doc,
    };
  });

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

  const handleCreateCategory = () => {
    setEditingCategory(null);
    setCategoryForm(defaultCategoryForm);
    setShowCategoryModal(true);
  };

  const handleEditCategory = (cat: DocCategory) => {
    setEditingCategory(cat);
    setCategoryForm({
      ordinal: String(cat.ordinal),
      name: cat.name,
      weight: String(cat.weight),
      max_score: String(cat.max_score),
    });
    setShowCategoryModal(true);
  };

  const handleCloseCategoryModal = () => {
    setShowCategoryModal(false);
    setEditingCategory(null);
    setCategoryForm(defaultCategoryForm);
  };

  const handleSaveCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const ord = parseInt(categoryForm.ordinal, 10);
    const weight = parseFloat(categoryForm.weight);
    const maxScore = parseFloat(categoryForm.max_score);

    if (isNaN(ord) || ord < 1 || ord > 4) {
      toast.error('Ordinal must be between 1 and 4');
      return;
    }
    if (!categoryForm.name.trim()) {
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

    setSavingCategory(true);
    try {
      const url = editingCategory
        ? `/documentation-scores/categories/${editingCategory.id}`
        : '/documentation-scores/categories';
      const method = editingCategory ? 'PATCH' : 'POST';
      const body = editingCategory
        ? {
            ordinal: ord,
            name: categoryForm.name.trim(),
            weight,
            max_score: maxScore,
          }
        : {
            event_id: selectedEventId,
            ordinal: ord,
            name: categoryForm.name.trim(),
            weight,
            max_score: maxScore,
          };

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save category');
      }

      toast.success(
        editingCategory ? 'Category updated!' : 'Category created!',
      );
      handleCloseCategoryModal();
      await fetchCategories();
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
      title: 'Delete Category',
      message: `Delete "${cat.name}"? This cannot be undone.`,
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });
    if (!ok) return;

    try {
      const res = await fetch(`/documentation-scores/categories/${cat.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to delete category');
      toast.success('Category deleted');
      await fetchCategories();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to delete category',
      );
    }
  };

  const handleOpenScoreModal = (team: Team) => {
    setEditingTeam(team);
    const doc = scoreByTeamId.get(team.id);
    const initial: Record<number, string> = {};
    for (const cat of categories) {
      const sub = doc?.sub_scores?.find((s) => s.category_id === cat.id);
      initial[cat.id] = sub != null ? String(sub.score) : '';
    }
    setScoreForm(initial);
    setShowScoreModal(true);
  };

  const handleCloseScoreModal = () => {
    setShowScoreModal(false);
    setEditingTeam(null);
    setScoreForm({});
  };

  const handleSaveScore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTeam) return;

    const sub_scores: { category_id: number; score: number }[] = [];
    for (const cat of categories) {
      const val = scoreForm[cat.id];
      if (val === '' || val == null) continue;
      const score = parseFloat(val);
      if (!Number.isFinite(score) || score < 0 || score > cat.max_score) {
        toast.error(`"${cat.name}" must be between 0 and ${cat.max_score}`);
        return;
      }
      sub_scores.push({ category_id: cat.id, score });
    }

    if (sub_scores.length === 0) {
      toast.error('Enter at least one category score');
      return;
    }

    setSavingScore(true);
    try {
      const res = await fetch(
        `/documentation-scores/event/${selectedEventId}/team/${editingTeam.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ sub_scores }),
        },
      );

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save score');
      }

      toast.success('Score saved!');
      handleCloseScoreModal();
      await fetchScores();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save score');
    } finally {
      setSavingScore(false);
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
      const res = await fetch(
        `/documentation-scores/event/${selectedEventId}/team/${team.id}`,
        { method: 'DELETE', credentials: 'include' },
      );
      if (!res.ok) throw new Error('Failed to clear score');
      toast.success('Score cleared');
      await fetchScores();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to clear score');
    }
  };

  const { rows: bulkParsed, errors: bulkParseErrors } = parseDocScoresText(
    bulkText,
    categories.length,
  );

  const handleBulkImport = async () => {
    if (bulkParsed.length === 0 || !selectedEventId) return;

    setBulkImporting(true);
    setBulkResults(null);
    const errors: { index: number; error: string }[] = [];
    let success = 0;

    for (let i = 0; i < bulkParsed.length; i++) {
      const row = bulkParsed[i];
      const team = teamByNumber.get(row.team_number);
      if (!team) {
        errors.push({ index: i, error: `Team ${row.team_number} not found` });
        continue;
      }

      const sub_scores = categories.map((cat, idx) => ({
        category_id: cat.id,
        score: row.scores[idx] ?? 0,
      }));

      try {
        const res = await fetch(
          `/documentation-scores/event/${selectedEventId}/team/${team.id}`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ sub_scores }),
          },
        );
        if (!res.ok) {
          const data = await res.json();
          errors.push({
            index: i,
            error: data.error || `Team ${row.team_number}: request failed`,
          });
        } else {
          success++;
        }
      } catch {
        errors.push({
          index: i,
          error: `Team ${row.team_number}: network error`,
        });
      }
    }

    setBulkResults({ success, errors });
    if (success > 0) {
      toast.success(`Imported ${success} score(s)`);
      await fetchScores();
    }
    if (errors.length > 0) {
      toast.warning(`${errors.length} row(s) failed`);
    }
    setBulkImporting(false);
  };

  const handleCloseBulkImport = () => {
    setShowBulkImport(false);
    setBulkText('');
    setBulkResults(null);
  };

  return (
    <div className="documentation-tab">
      {loading && <p style={{ color: 'var(--secondary-color)' }}>Loading...</p>}

      {/* Section A: Categories */}
      <div className="card documentation-section">
        <h3>Documentation Categories</h3>
        <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
          Define scoring categories for this event. Existing overall_score
          values are computed at save-time; re-saving a team score will
          recompute under new weights/max.
        </p>
        <button
          className="btn btn-primary"
          onClick={handleCreateCategory}
          disabled={categories.length >= 4}
        >
          + Add Category
        </button>
        {categories.length >= 4 && (
          <small
            style={{ marginLeft: '0.5rem', color: 'var(--secondary-color)' }}
          >
            (Max 4 categories)
          </small>
        )}
        <div style={{ marginTop: '1rem' }}>
          {categories.length === 0 ? (
            <p style={{ color: 'var(--secondary-color)' }}>
              No categories yet. Add categories to start scoring.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Ordinal</th>
                  <th>Name</th>
                  <th>Weight</th>
                  <th>Max Score</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((cat) => (
                  <tr key={cat.id}>
                    <td>{cat.ordinal}</td>
                    <td>{cat.name}</td>
                    <td>{cat.weight}</td>
                    <td>{cat.max_score}</td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleEditCategory(cat)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDeleteCategory(cat)}
                        style={{ marginLeft: '0.5rem' }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Section B: Team scores */}
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
            onClick={() => setShowBulkImport(true)}
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
          <table>
            <thead>
              <tr>
                <th>Team #</th>
                <th>Team Name</th>
                <th>Overall Score</th>
                <th>Scored At</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {mergedTeams.map(({ team, doc }) => (
                <tr key={team.id}>
                  <td>{team.team_number}</td>
                  <td>{team.team_name}</td>
                  <td>
                    {doc?.overall_score != null ? (
                      <strong style={{ color: 'var(--primary-color)' }}>
                        {doc.overall_score.toFixed(3)}
                      </strong>
                    ) : (
                      <em style={{ color: 'var(--secondary-color)' }}>—</em>
                    )}
                  </td>
                  <td>
                    {doc?.scored_at ? (
                      formatDateTime(doc.scored_at)
                    ) : (
                      <em style={{ color: 'var(--secondary-color)' }}>—</em>
                    )}
                  </td>
                  <td>
                    <button
                      className="btn btn-primary"
                      onClick={() => handleOpenScoreModal(team)}
                    >
                      {doc ? 'Edit' : 'Enter'} Score
                    </button>
                    {doc && (
                      <button
                        className="btn btn-danger"
                        onClick={() => handleClearScore(team)}
                        style={{ marginLeft: '0.5rem' }}
                      >
                        Clear
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Category modal */}
      {showCategoryModal && (
        <div className="modal show" onClick={handleCloseCategoryModal}>
          <div
            className="modal-content"
            style={{ maxWidth: '500px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="close" onClick={handleCloseCategoryModal}>
              &times;
            </span>
            <h3>{editingCategory ? 'Edit Category' : 'Add Category'}</h3>
            <form onSubmit={handleSaveCategory}>
              <div className="form-group">
                <label htmlFor="cat-ordinal">Ordinal (1–4) *</label>
                <input
                  id="cat-ordinal"
                  type="number"
                  className="field-input"
                  min={1}
                  max={4}
                  value={categoryForm.ordinal}
                  onChange={(e) =>
                    setCategoryForm({
                      ...categoryForm,
                      ordinal: e.target.value,
                    })
                  }
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="cat-name">Name *</label>
                <input
                  id="cat-name"
                  type="text"
                  className="field-input"
                  value={categoryForm.name}
                  onChange={(e) =>
                    setCategoryForm({ ...categoryForm, name: e.target.value })
                  }
                  required
                />
              </div>
              <div className="form-group">
                <label htmlFor="cat-weight">Weight</label>
                <input
                  id="cat-weight"
                  type="number"
                  className="field-input"
                  min={0}
                  step={0.1}
                  value={categoryForm.weight}
                  onChange={(e) =>
                    setCategoryForm({ ...categoryForm, weight: e.target.value })
                  }
                />
              </div>
              <div className="form-group">
                <label htmlFor="cat-max">Max Score *</label>
                <input
                  id="cat-max"
                  type="number"
                  className="field-input"
                  min={0.01}
                  step="any"
                  value={categoryForm.max_score}
                  onChange={(e) =>
                    setCategoryForm({
                      ...categoryForm,
                      max_score: e.target.value,
                    })
                  }
                  required
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  justifyContent: 'flex-end',
                  marginTop: '1.5rem',
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCloseCategoryModal}
                  disabled={savingCategory}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingCategory}
                >
                  {savingCategory ? 'Saving...' : 'Save'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Score modal */}
      {showScoreModal && editingTeam && (
        <div className="modal show" onClick={handleCloseScoreModal}>
          <div
            className="modal-content"
            style={{ maxWidth: '500px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="close" onClick={handleCloseScoreModal}>
              &times;
            </span>
            <h3>
              Documentation Score — Team {editingTeam.team_number}{' '}
              {editingTeam.team_name}
            </h3>
            <form onSubmit={handleSaveScore}>
              {categories.map((cat) => (
                <div key={cat.id} className="form-group">
                  <label htmlFor={`score-${cat.id}`}>
                    {cat.name} (0–{cat.max_score})
                  </label>
                  <input
                    id={`score-${cat.id}`}
                    type="number"
                    className="field-input"
                    min={0}
                    max={cat.max_score}
                    step={0.1}
                    value={scoreForm[cat.id] ?? ''}
                    onChange={(e) =>
                      setScoreForm({
                        ...scoreForm,
                        [cat.id]: e.target.value,
                      })
                    }
                  />
                </div>
              ))}
              <div
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  justifyContent: 'flex-end',
                  marginTop: '1.5rem',
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCloseScoreModal}
                  disabled={savingScore}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={savingScore}
                >
                  {savingScore ? 'Saving...' : 'Save Score'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bulk import modal */}
      {showBulkImport && (
        <div className="modal show" onClick={handleCloseBulkImport}>
          <div
            className="modal-content"
            style={{ maxWidth: '700px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="close" onClick={handleCloseBulkImport}>
              &times;
            </span>
            <h3>Bulk Import Documentation Scores</h3>
            <p
              style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}
            >
              Paste CSV or TSV. Format: team_number, score1, score2, ... (scores
              in category ordinal order). Optional header row (skipped if first
              column is non-numeric).
            </p>
            <p
              style={{
                color: 'var(--secondary-color)',
                marginBottom: '1rem',
                fontSize: '0.875rem',
              }}
            >
              Expected columns: 1 + {categories.length} ={' '}
              {1 + categories.length} (team_number +{' '}
              {categories.map((c) => c.name).join(', ')})
            </p>
            <div className="form-group">
              <label htmlFor="bulk-doc-text">Data</label>
              <textarea
                id="bulk-doc-text"
                className="field-input"
                rows={10}
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                placeholder={`Example:\n101\t15\t18\t12\n102\t20\t16\t14`}
              />
            </div>
            {bulkParsed.length > 0 && (
              <div className="bulk-preview" style={{ marginBottom: '1rem' }}>
                <h4>Preview ({bulkParsed.length} rows)</h4>
                <div className="bulk-preview-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Team #</th>
                        {categories.map((c) => (
                          <th key={c.id}>{c.name}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {bulkParsed.slice(0, 10).map((row, idx) => (
                        <tr key={idx}>
                          <td>{row.team_number}</td>
                          {row.scores.map((s, i) => (
                            <td key={i}>{s}</td>
                          ))}
                        </tr>
                      ))}
                      {bulkParsed.length > 10 && (
                        <tr>
                          <td
                            colSpan={1 + categories.length}
                            style={{
                              textAlign: 'center',
                              fontStyle: 'italic',
                            }}
                          >
                            ...and {bulkParsed.length - 10} more
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
            {bulkParseErrors.length > 0 && (
              <div className="bulk-errors" style={{ marginBottom: '1rem' }}>
                <h4>Parse Errors</h4>
                <ul>
                  {bulkParseErrors.map((err, idx) => (
                    <li key={idx}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
            {bulkResults && (
              <div className="bulk-results" style={{ marginBottom: '1rem' }}>
                <h4>Import Results</h4>
                <p>
                  Success: <strong>{bulkResults.success}</strong>
                </p>
                {bulkResults.errors.length > 0 && (
                  <>
                    <p>
                      Failed: <strong>{bulkResults.errors.length}</strong>
                    </p>
                    <ul>
                      {bulkResults.errors.map((e) => (
                        <li key={e.index}>
                          Row {e.index + 1}: {e.error}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                justifyContent: 'flex-end',
                marginTop: '1.5rem',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleCloseBulkImport}
              >
                Close
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleBulkImport}
                disabled={
                  bulkImporting ||
                  bulkParsed.length === 0 ||
                  bulkParseErrors.length > 0
                }
              >
                {bulkImporting
                  ? 'Importing...'
                  : `Import ${bulkParsed.length} Row(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
