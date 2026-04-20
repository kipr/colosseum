import { useEffect, useState } from 'react';
import { Modal, ModalActions } from '../../Modal';
import { BRACKET_SIZES, defaultFormData, type BracketFormData } from './types';
import type { BracketDetail } from '../../../types/brackets';

export interface EditBracketSubmit {
  name: string;
  bracket_size: number;
  actual_team_count: number | null;
  weight?: number;
}

interface EditBracketModalProps {
  open: boolean;
  bracket: BracketDetail | null;
  saving: boolean;
  onClose: () => void;
  onError: (message: string) => void;
  onSubmit: (data: EditBracketSubmit) => Promise<void>;
}

/** Modal for editing a bracket's metadata (name, size, weight, actual count). */
export function EditBracketModal({
  open,
  bracket,
  saving,
  onClose,
  onError,
  onSubmit,
}: EditBracketModalProps) {
  const [formData, setFormData] = useState<BracketFormData>(defaultFormData);

  useEffect(() => {
    if (open && bracket) {
      setFormData({
        name: bracket.name,
        bracket_size: bracket.bracket_size,
        actual_team_count: bracket.actual_team_count?.toString() ?? '',
        weight: bracket.weight?.toString() ?? '1',
      });
    }
  }, [open, bracket]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      onError('Bracket name is required');
      return;
    }
    let actualTeamCount: number | null = null;
    if (formData.actual_team_count) {
      const count = parseInt(formData.actual_team_count, 10);
      if (!isNaN(count) && count > 0) actualTeamCount = count;
    }
    let weight: number | undefined;
    if (formData.weight) {
      const w = parseFloat(formData.weight);
      if (!isNaN(w) && w > 0 && w <= 1) weight = w;
    }
    await onSubmit({
      name: formData.name.trim(),
      bracket_size: formData.bracket_size,
      actual_team_count: actualTeamCount,
      weight,
    });
  };

  return (
    <Modal
      open={open && !!bracket}
      onClose={onClose}
      title="Edit Bracket"
      maxWidth={500}
    >
      <p style={{ color: 'var(--secondary-color)', marginBottom: '1.5rem' }}>
        Update bracket details.
      </p>
      <form onSubmit={handleSubmit}>
        <div className="form-group">
          <label htmlFor="edit-bracket-name">Bracket Name *</label>
          <input
            id="edit-bracket-name"
            type="text"
            className="field-input"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="e.g., Main Bracket, Division A"
            required
            autoFocus
          />
        </div>

        <div className="form-group">
          <label htmlFor="edit-bracket-size">Bracket Size *</label>
          <select
            id="edit-bracket-size"
            className="field-input"
            value={formData.bracket_size}
            onChange={(e) =>
              setFormData({
                ...formData,
                bracket_size: parseInt(e.target.value, 10),
              })
            }
          >
            {BRACKET_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} teams
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="edit-actual-team-count">Actual Team Count</label>
          <input
            id="edit-actual-team-count"
            type="number"
            className="field-input"
            value={formData.actual_team_count}
            onChange={(e) =>
              setFormData({
                ...formData,
                actual_team_count: e.target.value,
              })
            }
            placeholder={`1-${formData.bracket_size}`}
            min={1}
            max={formData.bracket_size}
          />
        </div>

        <div className="form-group">
          <label htmlFor="edit-bracket-weight">Weight</label>
          <input
            id="edit-bracket-weight"
            type="number"
            className="field-input"
            value={formData.weight}
            onChange={(e) =>
              setFormData({ ...formData, weight: e.target.value })
            }
            placeholder="1"
            min={0.01}
            max={1}
            step="any"
          />
        </div>

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
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </ModalActions>
      </form>
    </Modal>
  );
}
