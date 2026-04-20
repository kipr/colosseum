import { useEffect, useState } from 'react';
import { Modal, ModalActions } from '../../Modal';
import {
  getBracketRowDisplay,
  getSeedingRowDisplay,
} from './scoringRowDisplay';
import type { ScoreSubmission } from './types';

interface BulkAcceptModalProps {
  open: boolean;
  pendingScores: ScoreSubmission[];
  accepting: boolean;
  onClose: () => void;
  onAccept: (selected: number[]) => Promise<void>;
}

/**
 * Modal that lists pending scores and lets the operator pick a subset to bulk-accept.
 * All scores are pre-selected when the modal opens.
 */
export function BulkAcceptModal({
  open,
  pendingScores,
  accepting,
  onClose,
  onAccept,
}: BulkAcceptModalProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (open) {
      setSelected(new Set(pendingScores.map((s) => s.id)));
    }
  }, [open, pendingScores]);

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(pendingScores.map((s) => s.id)));
  const selectNone = () => setSelected(new Set());

  const handleClose = () => {
    setSelected(new Set());
    onClose();
  };

  const handleAccept = async () => {
    if (selected.size === 0) return;
    await onAccept(Array.from(selected));
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Bulk Accept Scores"
      maxWidth={600}
    >
      <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
        Select the pending scores you want to accept. All scores are selected by
        default.
      </p>

      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={selectAll}
          style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
        >
          Select All
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={selectNone}
          style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
        >
          Select None
        </button>
        <span
          style={{
            marginLeft: 'auto',
            color: 'var(--secondary-color)',
            fontSize: '0.875rem',
            alignSelf: 'center',
          }}
        >
          {selected.size} of {pendingScores.length} selected
        </span>
      </div>

      <div className="bulk-accept-list">
        {pendingScores.length === 0 ? (
          <p style={{ color: 'var(--secondary-color)' }}>
            No pending scores in the current view. Filter by status
            &quot;Pending&quot; to see scores to accept.
          </p>
        ) : (
          pendingScores.map((score) => {
            const scoreType = score.score_type || 'unknown';
            if (scoreType === 'bracket') {
              const {
                team1Label,
                team2Label,
                gameLabel,
                scoreLabel,
                winnerLabel,
              } = getBracketRowDisplay(score);
              return (
                <label key={score.id} className="bulk-accept-item">
                  <input
                    type="checkbox"
                    checked={selected.has(score.id)}
                    onChange={() => toggle(score.id)}
                  />
                  <span className="bulk-accept-context">{gameLabel}</span>
                  <span className="bulk-accept-detail">
                    {team1Label} vs {team2Label} — {scoreLabel} → {winnerLabel}
                  </span>
                </label>
              );
            }
            const { teamNum, roundLabel, total } = getSeedingRowDisplay(score);
            return (
              <label key={score.id} className="bulk-accept-item">
                <input
                  type="checkbox"
                  checked={selected.has(score.id)}
                  onChange={() => toggle(score.id)}
                />
                <span className="bulk-accept-context">{roundLabel}</span>
                <span className="bulk-accept-detail">
                  Team {teamNum} — {total}
                </span>
              </label>
            );
          })
        )}
      </div>

      <ModalActions>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleClose}
          disabled={accepting}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-success"
          onClick={handleAccept}
          disabled={accepting || selected.size === 0}
        >
          {accepting ? 'Accepting...' : `Accept ${selected.size} Score(s)`}
        </button>
      </ModalActions>
    </Modal>
  );
}
