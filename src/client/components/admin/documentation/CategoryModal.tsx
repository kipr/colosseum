import { useEffect, useState, type FormEvent } from 'react';
import { Modal, ModalActions } from '../../Modal';
import {
  defaultCategoryForm,
  type CategoryFormData,
  type DocCategory,
  type GlobalCategory,
} from './types';

interface CategoryModalProps {
  open: boolean;
  editingCategory: DocCategory | null;
  globalCategories: GlobalCategory[];
  existingCategories: DocCategory[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (input: {
    editing: DocCategory | null;
    mode: 'create' | 'link';
    form: CategoryFormData;
    selectedGlobalCategoryId: number | null;
  }) => Promise<void>;
}

/**
 * Create / link / edit modal for a documentation category. Mirrors the
 * inline form that previously lived in `DocumentationTab`.
 */
export function CategoryModal({
  open,
  editingCategory,
  globalCategories,
  existingCategories,
  saving,
  onClose,
  onSubmit,
}: CategoryModalProps) {
  const [mode, setMode] = useState<'create' | 'link'>('create');
  const [selectedGlobalCategoryId, setSelectedGlobalCategoryId] = useState<
    number | null
  >(null);
  const [form, setForm] = useState<CategoryFormData>(defaultCategoryForm);

  useEffect(() => {
    if (!open) return;
    if (editingCategory) {
      setMode('create');
      setSelectedGlobalCategoryId(null);
      setForm({
        ordinal: String(editingCategory.ordinal),
        name: editingCategory.name,
        weight: String(editingCategory.weight),
        max_score: String(editingCategory.max_score),
      });
    } else {
      setMode('create');
      setSelectedGlobalCategoryId(null);
      setForm(defaultCategoryForm);
    }
  }, [open, editingCategory]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit({
      editing: editingCategory,
      mode,
      form,
      selectedGlobalCategoryId,
    });
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editingCategory ? 'Edit Category' : 'Add Category'}
      maxWidth={500}
    >
      <form onSubmit={handleSubmit}>
        {!editingCategory && (
          <div className="form-group">
            <label>Add as</label>
            <div
              style={{
                display: 'flex',
                gap: '1rem',
                marginTop: '0.25rem',
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <input
                  type="radio"
                  name="cat-mode"
                  checked={mode === 'create'}
                  onChange={() => {
                    setMode('create');
                    setSelectedGlobalCategoryId(null);
                    setForm(defaultCategoryForm);
                  }}
                />
                Create new category
              </label>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <input
                  type="radio"
                  name="cat-mode"
                  checked={mode === 'link'}
                  onChange={() => {
                    setMode('link');
                    setSelectedGlobalCategoryId(null);
                    setForm(defaultCategoryForm);
                  }}
                />
                Select existing category
              </label>
            </div>
          </div>
        )}
        {!editingCategory && mode === 'link' && (
          <div className="form-group">
            <label htmlFor="cat-global">Category *</label>
            <select
              id="cat-global"
              className="field-input"
              value={selectedGlobalCategoryId ?? ''}
              onChange={(e) => {
                const id = e.target.value ? parseInt(e.target.value, 10) : null;
                setSelectedGlobalCategoryId(id);
                const gc = globalCategories.find((c) => c.id === id);
                if (gc) {
                  setForm({
                    ...form,
                    name: gc.name,
                    weight: String(gc.weight),
                    max_score: String(gc.max_score),
                  });
                }
              }}
              required={mode === 'link'}
            >
              <option value="">— Select —</option>
              {globalCategories
                .filter((gc) => !existingCategories.some((c) => c.id === gc.id))
                .map((gc) => (
                  <option key={gc.id} value={gc.id}>
                    {gc.name} (max {gc.max_score}, ×{gc.weight})
                  </option>
                ))}
            </select>
          </div>
        )}
        <div className="form-group">
          <label htmlFor="cat-ordinal">Ordinal (1–4) *</label>
          <input
            id="cat-ordinal"
            type="number"
            className="field-input"
            min={1}
            max={4}
            value={form.ordinal}
            onChange={(e) => setForm({ ...form, ordinal: e.target.value })}
            required
          />
        </div>
        {!editingCategory && mode === 'create' && (
          <>
            <div className="form-group">
              <label htmlFor="cat-name">Name *</label>
              <input
                id="cat-name"
                type="text"
                className="field-input"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
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
                value={form.weight}
                onChange={(e) => setForm({ ...form, weight: e.target.value })}
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
                value={form.max_score}
                onChange={(e) =>
                  setForm({ ...form, max_score: e.target.value })
                }
                required
              />
            </div>
          </>
        )}
        {mode === 'link' && selectedGlobalCategoryId && (
          <div
            className="form-group"
            style={{
              color: 'var(--secondary-color)',
              fontSize: '0.875rem',
            }}
          >
            {(() => {
              const gc = globalCategories.find(
                (c) => c.id === selectedGlobalCategoryId,
              );
              return gc
                ? `${gc.name}: max ${gc.max_score}, weight ×${gc.weight}`
                : null;
            })()}
          </div>
        )}
        <ModalActions>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}
