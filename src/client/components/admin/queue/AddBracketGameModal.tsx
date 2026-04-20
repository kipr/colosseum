import { useEffect, useState } from 'react';
import { Modal, ModalActions } from '../../Modal';
import type { Bracket, BracketGame } from './queueHelpers';

interface AddBracketGameModalProps {
  open: boolean;
  brackets: Bracket[];
  bracketGames: BracketGame[];
  onClose: () => void;
  onLoadGames: (bracketId: number) => Promise<void> | void;
  onClearGames: () => void;
  onSubmit: (gameId: number) => Promise<void>;
}

export function AddBracketGameModal({
  open,
  brackets,
  bracketGames,
  onClose,
  onLoadGames,
  onClearGames,
  onSubmit,
}: AddBracketGameModalProps) {
  const [selectedBracketId, setSelectedBracketId] = useState<number | null>(
    null,
  );
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (bracketGames.length > 0 && selectedGameId == null) {
      setSelectedGameId(bracketGames[0].id);
    }
  }, [bracketGames, selectedGameId]);

  const handleClick = async () => {
    if (selectedGameId == null) return;
    setAdding(true);
    try {
      await onSubmit(selectedGameId);
    } finally {
      setAdding(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Bracket Game to Queue"
      maxWidth={600}
    >
      <p style={{ color: 'var(--secondary-color)', marginBottom: '1.5rem' }}>
        Add a specific bracket game to the queue. Games are automatically
        queued—are you sure you need to add this? Have you double checked the
        list?
      </p>

      {brackets.length === 0 ? (
        <p style={{ color: 'var(--secondary-color)' }}>
          No brackets found for this event.
        </p>
      ) : (
        <>
          <div className="form-group">
            <label htmlFor="bracket-select">Select Bracket</label>
            <select
              id="bracket-select"
              className="field-input"
              value={selectedBracketId ?? ''}
              onChange={(e) => {
                const bracketId = Number(e.target.value);
                setSelectedBracketId(bracketId || null);
                setSelectedGameId(null);
                if (bracketId) {
                  onLoadGames(bracketId);
                } else {
                  onClearGames();
                }
              }}
            >
              <option value="">Select a bracket...</option>
              {brackets.map((bracket) => (
                <option key={bracket.id} value={bracket.id}>
                  {bracket.name} ({bracket.bracket_size} teams)
                </option>
              ))}
            </select>
          </div>

          {selectedBracketId && (
            <div className="form-group">
              <label htmlFor="game-select">Select Game</label>
              {bracketGames.length === 0 ? (
                <p
                  style={{
                    color: 'var(--secondary-color)',
                    fontSize: '0.9rem',
                  }}
                >
                  No eligible games found (games must have both teams assigned
                  and not be completed).
                </p>
              ) : (
                <select
                  id="game-select"
                  className="field-input"
                  value={selectedGameId ?? ''}
                  onChange={(e) => setSelectedGameId(Number(e.target.value))}
                >
                  {bracketGames.map((game) => (
                    <option key={game.id} value={game.id}>
                      Game {game.game_number}
                      {game.round_name && ` - ${game.round_name}`}: #
                      {game.team1_number} {game.team1_name} vs #
                      {game.team2_number} {game.team2_name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

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
              disabled={adding || !selectedGameId}
            >
              {adding ? 'Adding...' : 'Add to Queue'}
            </button>
          </ModalActions>
        </>
      )}
    </Modal>
  );
}
