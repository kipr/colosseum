import { useState } from 'react';
import { Modal, ModalActions } from '../../Modal';
import type { Bracket } from './queueHelpers';

interface PopulateFromBracketModalProps {
  open: boolean;
  brackets: Bracket[];
  onClose: () => void;
  onSubmit: (bracketId: number) => Promise<void>;
}

export function PopulateFromBracketModal({
  open,
  brackets,
  onClose,
  onSubmit,
}: PopulateFromBracketModalProps) {
  const [selectedBracketId, setSelectedBracketId] = useState<number | null>(
    brackets[0]?.id ?? null,
  );
  const [populating, setPopulating] = useState(false);

  if (open && selectedBracketId == null && brackets.length > 0) {
    setSelectedBracketId(brackets[0].id);
  }

  const handleClick = async () => {
    if (selectedBracketId == null) return;
    setPopulating(true);
    try {
      await onSubmit(selectedBracketId);
    } finally {
      setPopulating(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Populate Queue from Bracket"
      maxWidth={500}
    >
      <p style={{ color: 'var(--secondary-color)', marginBottom: '1.5rem' }}>
        This will completely clear the existing queue and replace it with
        eligible games from the selected bracket. Games must have both teams
        assigned.
      </p>

      {brackets.length === 0 ? (
        <p style={{ color: 'var(--secondary-color)' }}>
          No brackets found for this event.
        </p>
      ) : (
        <>
          <div className="form-group">
            <label htmlFor="populate-bracket">Select Bracket</label>
            <select
              id="populate-bracket"
              className="field-input"
              value={selectedBracketId ?? ''}
              onChange={(e) => setSelectedBracketId(Number(e.target.value))}
            >
              {brackets.map((bracket) => (
                <option key={bracket.id} value={bracket.id}>
                  {bracket.name} ({bracket.bracket_size} teams)
                </option>
              ))}
            </select>
          </div>

          <ModalActions>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={populating}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleClick}
              disabled={populating || !selectedBracketId}
            >
              {populating ? 'Populating...' : 'Populate Queue'}
            </button>
          </ModalActions>
        </>
      )}
    </Modal>
  );
}
