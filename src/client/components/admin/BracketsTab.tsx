import React, { useState, useEffect, useCallback } from 'react';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import { formatDateTime } from '../../utils/dateUtils';
import {
  Bracket,
  BracketDetail,
  BracketGame,
  BracketStatus,
  GameStatus,
  STATUS_LABELS,
  GAME_STATUS_LABELS,
} from '../../types/brackets';
import BracketLikeView from '../bracket/BracketLikeView';
import '../Modal.css';
import './BracketsTab.css';

type DetailViewMode = 'management' | 'bracket';

interface BracketFormData {
  name: string;
  bracket_size: number;
  actual_team_count: string;
}

const BRACKET_SIZES = [4, 8, 16, 32, 64];

function getStatusClass(status: BracketStatus): string {
  switch (status) {
    case 'setup':
      return 'status-setup';
    case 'in_progress':
      return 'status-in-progress';
    case 'completed':
      return 'status-completed';
    default:
      return '';
  }
}

function getGameStatusClass(status: GameStatus): string {
  switch (status) {
    case 'pending':
      return 'game-status-pending';
    case 'ready':
      return 'game-status-ready';
    case 'in_progress':
      return 'game-status-in-progress';
    case 'completed':
      return 'game-status-completed';
    case 'bye':
      return 'game-status-bye';
    default:
      return '';
  }
}

const defaultFormData: BracketFormData = {
  name: '',
  bracket_size: 8,
  actual_team_count: '',
};

export default function BracketsTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;
  // List state
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [loading, setLoading] = useState(false);

  // Selected bracket detail
  const [selectedBracketId, setSelectedBracketId] = useState<number | null>(
    null,
  );
  const [bracketDetail, setBracketDetail] = useState<BracketDetail | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);

  // Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [formData, setFormData] = useState<BracketFormData>(defaultFormData);
  const [saving, setSaving] = useState(false);

  // Action states
  const [generatingEntries, setGeneratingEntries] = useState(false);
  const [generatingGames, setGeneratingGames] = useState(false);
  const [advancingWinner, setAdvancingWinner] = useState<number | null>(null);

  // View mode state (management vs bracket-like view)
  const [detailViewMode, setDetailViewMode] =
    useState<DetailViewMode>('management');

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  // Fetch brackets for event
  const fetchBrackets = useCallback(async () => {
    if (!selectedEventId) {
      setBrackets([]);
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/brackets/event/${selectedEventId}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch brackets');
      }
      const data: Bracket[] = await response.json();
      setBrackets(data);
    } catch (error) {
      console.error('Error fetching brackets:', error);
      toast.error('Failed to load brackets');
    } finally {
      setLoading(false);
    }
  }, [selectedEventId]);

  // Fetch bracket detail
  const fetchBracketDetail = useCallback(async (bracketId: number) => {
    setDetailLoading(true);
    try {
      const response = await fetch(`/brackets/${bracketId}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        throw new Error('Failed to fetch bracket details');
      }
      const data: BracketDetail = await response.json();
      setBracketDetail(data);
    } catch (error) {
      console.error('Error fetching bracket detail:', error);
      toast.error('Failed to load bracket details');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBrackets();
    setSelectedBracketId(null);
    setBracketDetail(null);
  }, [fetchBrackets]);

  useEffect(() => {
    if (selectedBracketId) {
      fetchBracketDetail(selectedBracketId);
    } else {
      setBracketDetail(null);
    }
  }, [selectedBracketId, fetchBracketDetail]);

  // Create bracket
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId) return;

    if (!formData.name.trim()) {
      toast.error('Bracket name is required');
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        event_id: selectedEventId,
        name: formData.name.trim(),
        bracket_size: formData.bracket_size,
      };

      if (formData.actual_team_count) {
        const count = parseInt(formData.actual_team_count, 10);
        if (!isNaN(count) && count > 0 && count <= formData.bracket_size) {
          body.actual_team_count = count;
        }
      }

      const response = await fetch('/brackets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create bracket');
      }

      toast.success('Bracket created!');
      setShowCreateModal(false);
      setFormData(defaultFormData);
      await fetchBrackets();
    } catch (error) {
      console.error('Error creating bracket:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to create bracket',
      );
    } finally {
      setSaving(false);
    }
  };

  // Update bracket
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bracketDetail) return;

    if (!formData.name.trim()) {
      toast.error('Bracket name is required');
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name: formData.name.trim(),
        bracket_size: formData.bracket_size,
      };

      if (formData.actual_team_count) {
        const count = parseInt(formData.actual_team_count, 10);
        if (!isNaN(count) && count > 0) {
          body.actual_team_count = count;
        }
      } else {
        body.actual_team_count = null;
      }

      const response = await fetch(`/brackets/${bracketDetail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update bracket');
      }

      toast.success('Bracket updated!');
      setShowEditModal(false);
      await fetchBrackets();
      await fetchBracketDetail(bracketDetail.id);
    } catch (error) {
      console.error('Error updating bracket:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to update bracket',
      );
    } finally {
      setSaving(false);
    }
  };

  // Delete bracket
  const handleDelete = async (bracket: Bracket) => {
    const confirmed = await confirm({
      title: 'Delete Bracket',
      message: `Are you sure you want to delete "${bracket.name}"? This will remove all entries and games. This cannot be undone.`,
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });

    if (!confirmed) return;

    try {
      const response = await fetch(`/brackets/${bracket.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok && response.status !== 204) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to delete bracket');
      }

      toast.success('Bracket deleted');
      if (selectedBracketId === bracket.id) {
        setSelectedBracketId(null);
        setBracketDetail(null);
      }
      await fetchBrackets();
    } catch (error) {
      console.error('Error deleting bracket:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to delete bracket',
      );
    }
  };

  // Generate entries from seeding
  const handleGenerateEntries = async () => {
    if (!bracketDetail) return;

    const hasEntries = bracketDetail.entries.length > 0;
    if (hasEntries) {
      const confirmed = await confirm({
        title: 'Regenerate Entries',
        message:
          'This bracket already has entries. Regenerating will replace them. Continue?',
        confirmText: 'Regenerate',
        confirmStyle: 'warning',
      });
      if (!confirmed) return;
    }

    setGeneratingEntries(true);
    try {
      const url = `/brackets/${bracketDetail.id}/entries/generate${hasEntries ? '?force=true' : ''}`;
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate entries');
      }

      const data = await response.json();
      toast.success(
        `Generated ${data.entriesCreated} entries (${data.byeCount} byes)`,
      );
      await fetchBracketDetail(bracketDetail.id);
    } catch (error) {
      console.error('Error generating entries:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to generate entries',
      );
    } finally {
      setGeneratingEntries(false);
    }
  };

  // Generate games from templates
  const handleGenerateGames = async () => {
    if (!bracketDetail) return;

    const hasGames = bracketDetail.games.length > 0;
    if (hasGames) {
      const confirmed = await confirm({
        title: 'Regenerate Games',
        message:
          'This bracket already has games. Regenerating will replace them. Continue?',
        confirmText: 'Regenerate',
        confirmStyle: 'warning',
      });
      if (!confirmed) return;
    }

    setGeneratingGames(true);
    try {
      const url = `/brackets/${bracketDetail.id}/games/generate${hasGames ? '?force=true' : ''}`;
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'include',
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate games');
      }

      const data = await response.json();
      toast.success(`Generated ${data.gamesCreated} games`);
      await fetchBracketDetail(bracketDetail.id);
    } catch (error) {
      console.error('Error generating games:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to generate games',
      );
    } finally {
      setGeneratingGames(false);
    }
  };

  // Advance winner
  const handleAdvanceWinner = async (game: BracketGame, winnerId: number) => {
    if (!bracketDetail) return;

    setAdvancingWinner(game.id);
    try {
      const response = await fetch(
        `/brackets/${bracketDetail.id}/advance-winner`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            game_id: game.id,
            winner_id: winnerId,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to advance winner');
      }

      toast.success('Winner advanced!');
      await fetchBracketDetail(bracketDetail.id);
    } catch (error) {
      console.error('Error advancing winner:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to advance winner',
      );
    } finally {
      setAdvancingWinner(null);
    }
  };

  // Update bracket status
  const handleStatusChange = async (newStatus: BracketStatus) => {
    if (!bracketDetail) return;

    try {
      const response = await fetch(`/brackets/${bracketDetail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update status');
      }

      toast.success(`Bracket status updated to ${STATUS_LABELS[newStatus]}`);
      await fetchBrackets();
      await fetchBracketDetail(bracketDetail.id);
    } catch (error) {
      console.error('Error updating bracket status:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to update status',
      );
    }
  };

  // Open edit modal
  const handleOpenEditModal = () => {
    if (!bracketDetail) return;
    setFormData({
      name: bracketDetail.name,
      bracket_size: bracketDetail.bracket_size,
      actual_team_count: bracketDetail.actual_team_count?.toString() || '',
    });
    setShowEditModal(true);
  };

  // Render team display
  const renderTeamDisplay = (
    teamId: number | null,
    teamNumber?: number,
    teamName?: string,
    teamDisplay?: string | null,
  ) => {
    if (!teamId) {
      return <span className="team-tbd">TBD</span>;
    }
    return (
      <span className="team-name">
        <strong>{teamNumber}</strong> {teamName || teamDisplay}
      </span>
    );
  };

  // No event selected
  if (!selectedEventId) {
    return (
      <div className="brackets-tab">
        <div className="card">
          <p style={{ color: 'var(--secondary-color)' }}>
            Please select an event from the dropdown above to manage brackets.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="brackets-tab">
      {/* Brackets List */}
      {!selectedBracketId && (
        <>
          <div className="brackets-controls">
            <button
              className="btn btn-primary"
              onClick={() => {
                setFormData(defaultFormData);
                setShowCreateModal(true);
              }}
            >
              + Create Bracket
            </button>
          </div>

          <div className="card">
            {loading ? (
              <p>Loading brackets...</p>
            ) : brackets.length === 0 ? (
              <p style={{ color: 'var(--secondary-color)' }}>
                No brackets created for this event yet. Create a bracket to get
                started.
              </p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Size</th>
                    <th>Teams</th>
                    <th>Status</th>
                    <th>Created</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {brackets.map((bracket) => (
                    <tr key={bracket.id}>
                      <td>
                        <strong>{bracket.name}</strong>
                      </td>
                      <td>{bracket.bracket_size}</td>
                      <td>{bracket.actual_team_count || '—'}</td>
                      <td>
                        <span
                          className={`bracket-status-badge ${getStatusClass(bracket.status)}`}
                        >
                          {STATUS_LABELS[bracket.status]}
                        </span>
                      </td>
                      <td>{formatDateTime(bracket.created_at)}</td>
                      <td>
                        <div className="bracket-actions">
                          <button
                            className="btn btn-primary"
                            onClick={() => setSelectedBracketId(bracket.id)}
                          >
                            View
                          </button>
                          <button
                            className="btn btn-danger"
                            onClick={() => handleDelete(bracket)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* Bracket Detail View */}
      {selectedBracketId && (
        <>
          <div className="brackets-controls">
            <button
              className="btn btn-secondary"
              onClick={() => {
                setSelectedBracketId(null);
                setBracketDetail(null);
                setDetailViewMode('management');
              }}
            >
              ← Back to List
            </button>
            {bracketDetail && bracketDetail.games.length > 0 && (
              <div className="view-mode-toggle">
                <button
                  className={`btn ${detailViewMode === 'management' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setDetailViewMode('management')}
                >
                  Management View
                </button>
                <button
                  className={`btn ${detailViewMode === 'bracket' ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setDetailViewMode('bracket')}
                >
                  Bracket View
                </button>
              </div>
            )}
          </div>

          {detailLoading ? (
            <p>Loading bracket details...</p>
          ) : bracketDetail ? (
            <>
              {/* Bracket Header */}
              <div className="card bracket-header-card">
                <div className="bracket-header">
                  <div className="bracket-header-info">
                    <h3>{bracketDetail.name}</h3>
                    <div className="bracket-meta">
                      <span>
                        <strong>Size:</strong> {bracketDetail.bracket_size}
                      </span>
                      <span>
                        <strong>Teams:</strong>{' '}
                        {bracketDetail.actual_team_count || 'Not set'}
                      </span>
                      <span
                        className={`bracket-status-badge ${getStatusClass(bracketDetail.status)}`}
                      >
                        {STATUS_LABELS[bracketDetail.status]}
                      </span>
                    </div>
                  </div>
                  <div className="bracket-header-actions">
                    <button
                      className="btn btn-secondary"
                      onClick={handleOpenEditModal}
                    >
                      Edit
                    </button>
                    {bracketDetail.status === 'setup' && (
                      <button
                        className="btn btn-success"
                        onClick={() => handleStatusChange('in_progress')}
                      >
                        Start Bracket
                      </button>
                    )}
                    {bracketDetail.status === 'in_progress' && (
                      <>
                        <button
                          className="btn btn-primary"
                          onClick={() => handleStatusChange('completed')}
                        >
                          Mark Complete
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={() => handleStatusChange('setup')}
                        >
                          Back to Setup
                        </button>
                      </>
                    )}
                    {bracketDetail.status === 'completed' && (
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleStatusChange('in_progress')}
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Bracket-like View */}
              {detailViewMode === 'bracket' && (
                <div className="card bracket-section">
                  <BracketLikeView games={bracketDetail.games} />
                </div>
              )}

              {/* Management View: Entries + Games Sections */}
              {detailViewMode === 'management' && (
                <>
                  {/* Entries Section */}
                  <div className="card bracket-section">
                    <div className="bracket-section-header">
                      <h4>Bracket Entries ({bracketDetail.entries.length})</h4>
                      <button
                        className="btn btn-primary"
                        onClick={handleGenerateEntries}
                        disabled={generatingEntries}
                      >
                        {generatingEntries
                          ? 'Generating...'
                          : bracketDetail.entries.length > 0
                            ? 'Regenerate from Seeding'
                            : 'Generate from Seeding'}
                      </button>
                    </div>

                    {bracketDetail.entries.length === 0 ? (
                      <p style={{ color: 'var(--secondary-color)' }}>
                        No entries yet. Click "Generate from Seeding" to
                        populate entries from seeding rankings.
                      </p>
                    ) : (
                      <div className="entries-grid">
                        {bracketDetail.entries.map((entry) => (
                          <div
                            key={entry.id}
                            className={`entry-card ${entry.is_bye ? 'entry-bye' : ''}`}
                          >
                            <span className="entry-seed">
                              #{entry.seed_position}
                            </span>
                            {entry.is_bye ? (
                              <span className="entry-bye-label">BYE</span>
                            ) : (
                              <span className="entry-team">
                                <strong>{entry.team_number}</strong>{' '}
                                {entry.team_name || entry.display_name}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Games Section */}
                  <div className="card bracket-section">
                    <div className="bracket-section-header">
                      <h4>Bracket Games ({bracketDetail.games.length})</h4>
                      <button
                        className="btn btn-primary"
                        onClick={handleGenerateGames}
                        disabled={
                          generatingGames || bracketDetail.entries.length === 0
                        }
                        title={
                          bracketDetail.entries.length === 0
                            ? 'Generate entries first'
                            : ''
                        }
                      >
                        {generatingGames
                          ? 'Generating...'
                          : bracketDetail.games.length > 0
                            ? 'Regenerate Games'
                            : 'Generate Games'}
                      </button>
                    </div>

                    {bracketDetail.games.length === 0 ? (
                      <p style={{ color: 'var(--secondary-color)' }}>
                        No games yet. Generate entries first, then click
                        "Generate Games" to create the bracket structure.
                      </p>
                    ) : (
                      <div className="games-list">
                        {/* Group games by bracket_side */}
                        {['winners', 'losers', 'finals'].map((side) => {
                          const sideGames = bracketDetail.games.filter(
                            (g) => g.bracket_side === side,
                          );
                          if (sideGames.length === 0) return null;

                          return (
                            <div key={side} className="games-side-group">
                              <h5 className="games-side-title">
                                {side === 'winners'
                                  ? 'Winners Bracket'
                                  : side === 'losers'
                                    ? 'Losers Bracket'
                                    : 'Finals'}
                              </h5>
                              <table className="games-table">
                                <thead>
                                  <tr>
                                    <th>Game</th>
                                    <th>Round</th>
                                    <th>Team 1</th>
                                    <th>Team 2</th>
                                    <th>Status</th>
                                    <th>Winner</th>
                                    <th>Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {sideGames.map((game) => (
                                    <tr key={game.id}>
                                      <td>
                                        <strong>Game {game.game_number}</strong>
                                      </td>
                                      <td>{game.round_name || '—'}</td>
                                      <td>
                                        {renderTeamDisplay(
                                          game.team1_id,
                                          game.team1_number,
                                          game.team1_name,
                                          game.team1_display,
                                        )}
                                      </td>
                                      <td>
                                        {renderTeamDisplay(
                                          game.team2_id,
                                          game.team2_number,
                                          game.team2_name,
                                          game.team2_display,
                                        )}
                                      </td>
                                      <td>
                                        <span
                                          className={`game-status-badge ${getGameStatusClass(game.status)}`}
                                        >
                                          {GAME_STATUS_LABELS[game.status]}
                                        </span>
                                      </td>
                                      <td>
                                        {game.winner_id
                                          ? renderTeamDisplay(
                                              game.winner_id,
                                              game.winner_number,
                                              game.winner_name,
                                              game.winner_display,
                                            )
                                          : '—'}
                                      </td>
                                      <td>
                                        {game.status !== 'completed' &&
                                          game.status !== 'bye' &&
                                          game.team1_id &&
                                          game.team2_id && (
                                            <div className="game-actions">
                                              <button
                                                className="btn btn-sm btn-success"
                                                onClick={() =>
                                                  handleAdvanceWinner(
                                                    game,
                                                    game.team1_id!,
                                                  )
                                                }
                                                disabled={
                                                  advancingWinner === game.id
                                                }
                                                title={`${game.team1_number} wins`}
                                              >
                                                {advancingWinner === game.id
                                                  ? '...'
                                                  : `#${game.team1_number} Wins`}
                                              </button>
                                              <button
                                                className="btn btn-sm btn-success"
                                                onClick={() =>
                                                  handleAdvanceWinner(
                                                    game,
                                                    game.team2_id!,
                                                  )
                                                }
                                                disabled={
                                                  advancingWinner === game.id
                                                }
                                                title={`${game.team2_number} wins`}
                                              >
                                                {advancingWinner === game.id
                                                  ? '...'
                                                  : `#${game.team2_number} Wins`}
                                              </button>
                                            </div>
                                          )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </>
              )}
            </>
          ) : (
            <p>Bracket not found.</p>
          )}
        </>
      )}

      {/* Create Modal */}
      {showCreateModal && (
        <div className="modal show" onClick={() => setShowCreateModal(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: '500px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="close" onClick={() => setShowCreateModal(false)}>
              &times;
            </span>
            <h3>Create Bracket</h3>
            <p
              style={{
                color: 'var(--secondary-color)',
                marginBottom: '1.5rem',
              }}
            >
              Create a new double-elimination bracket for this event.
            </p>

            <form onSubmit={handleCreate}>
              <div className="form-group">
                <label htmlFor="bracket-name">Bracket Name *</label>
                <input
                  id="bracket-name"
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
                <label htmlFor="bracket-size">Bracket Size *</label>
                <select
                  id="bracket-size"
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
                <small style={{ color: 'var(--secondary-color)' }}>
                  Choose the smallest power of 2 that fits your teams.
                </small>
              </div>

              <div className="form-group">
                <label htmlFor="actual-team-count">Actual Team Count</label>
                <input
                  id="actual-team-count"
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
                <small style={{ color: 'var(--secondary-color)' }}>
                  Optional. If fewer than bracket size, byes will be added.
                </small>
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
                  onClick={() => setShowCreateModal(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving ? 'Creating...' : 'Create Bracket'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && bracketDetail && (
        <div className="modal show" onClick={() => setShowEditModal(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: '500px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="close" onClick={() => setShowEditModal(false)}>
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

            <form onSubmit={handleUpdate}>
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
                <label htmlFor="edit-actual-team-count">
                  Actual Team Count
                </label>
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
                  onClick={() => setShowEditModal(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
