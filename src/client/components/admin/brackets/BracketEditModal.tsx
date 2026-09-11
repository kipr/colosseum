import { FormEvent } from 'react';
import { BRACKET_SIZES } from '../../../types/brackets';
import type { BracketFormData } from './BracketCreateModal';
import '../../Modal.css';

interface BracketEditModalProps {
  formData: BracketFormData;
  setFormData: (data: BracketFormData) => void;
  saving: boolean;
  onClose: () => void;
  onSubmit: (e: FormEvent) => void;
}

export default function BracketEditModal({
  formData,
  setFormData,
  saving,
  onClose,
  onSubmit,
}: BracketEditModalProps) {
  return (
    <div className="modal show" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '500px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="close" onClick={onClose}>
          &times;
        </span>
        <h3>Edit Bracket</h3>
        <p
          style={{
            color: 'var(--secondary-color)',
            marginBottom: '1.5rem',
          }}
        >
          Update bracket details.
        </p>

        <form onSubmit={onSubmit}>
          <div className="form-group">
            <label htmlFor="edit-bracket-name">Bracket Name *</label>
            <input
              id="edit-bracket-name"
              type="text"
              className="field-input"
              value={formData.name}
              onChange={(e) =>
                setFormData({ ...formData, name: e.target.value })
              }
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
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
