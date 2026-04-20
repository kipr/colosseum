import { useEffect, useState } from 'react';
import { Modal, ModalActions } from '../../Modal';
import type { Team } from './queueHelpers';

interface AddSeedingModalProps {
  open: boolean;
  teams: Team[];
  seedingRounds: number;
  onClose: () => void;
  onSubmit: (teamId: number, round: number) => Promise<void>;
}

export function AddSeedingModal({
  open,
  teams,
  seedingRounds,
  onClose,
  onSubmit,
}: AddSeedingModalProps) {
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [selectedRound, setSelectedRound] = useState<number>(1);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (open && teams.length > 0 && selectedTeamId == null) {
      setSelectedTeamId(teams[0].id);
    }
  }, [open, teams, selectedTeamId]);

  const handleClick = async () => {
    if (selectedTeamId == null) return;
    setAdding(true);
    try {
      await onSubmit(selectedTeamId, selectedRound);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Seeding Round to Queue"
      maxWidth={500}
    >
      <p style={{ color: 'var(--secondary-color)', marginBottom: '1.5rem' }}>
        Add a specific team&apos;s seeding round to the queue. Games are
        automatically queued—are you sure you need to add this? Have you double
        checked the list?
      </p>

      {teams.length === 0 ? (
        <p style={{ color: 'var(--secondary-color)' }}>
          No teams found for this event.
        </p>
      ) : (
        <>
          <div className="form-group">
            <label htmlFor="seeding-team">Select Team</label>
            <select
              id="seeding-team"
              className="field-input"
              value={selectedTeamId ?? ''}
              onChange={(e) => setSelectedTeamId(Number(e.target.value))}
            >
              {teams.map((team) => (
                <option key={team.id} value={team.id}>
                  #{team.team_number} {team.team_name}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="seeding-round">Round</label>
            <select
              id="seeding-round"
              className="field-input"
              value={selectedRound}
              onChange={(e) => setSelectedRound(Number(e.target.value))}
            >
              {Array.from({ length: seedingRounds }, (_, i) => i + 1).map(
                (round) => (
                  <option key={round} value={round}>
                    Round {round}
                  </option>
                ),
              )}
            </select>
          </div>

          <ModalActions>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClose}
              disabled={adding}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={handleClick}
              disabled={adding || !selectedTeamId}
            >
              {adding ? 'Adding...' : 'Add to Queue'}
            </button>
          </ModalActions>
        </>
      )}
    </Modal>
  );
}
