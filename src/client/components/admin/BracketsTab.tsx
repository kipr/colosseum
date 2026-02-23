import React, { useState, useEffect, useCallback } from 'react';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import {
  Bracket,
  BracketDetail,
  BracketStatus,
  STATUS_LABELS,
} from '../../types/brackets';
import BracketListTable from '../bracket/BracketListTable';
import BracketDetailView from '../bracket/BracketDetailView';
import '../Modal.css';
import './BracketsTab.css';

interface BracketFormData {
  name: string;
  bracket_size: number;
  actual_team_count: string;
}

interface CreateModalTeam {
  id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

interface CreateModalScore {
  team_id: number;
  round_number: number;
  score: number | null;
  team_number: number;
  team_name: string;
}

interface CreateModalRanking {
  team_id: number;
  seed_average: number | null;
  seed_rank: number | null;
  raw_seed_score: number | null;
  team_number: number;
  team_name: string;
}

interface AssignedTeam {
  team_id: number;
  team_number: number;
  team_name: string;
  bracket_id: number;
  bracket_name: string;
}

function nextPowerOfTwo(n: number): number {
  if (n <= 0) return 4;
  const p = Math.pow(2, Math.ceil(Math.log2(n)));
  return Math.max(4, Math.min(64, p));
}

const BRACKET_SIZES = [4, 8, 16, 32, 64];

const defaultFormData: BracketFormData = {
  name: '',
  bracket_size: 8,
  actual_team_count: '',
};

export default function BracketsTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [loading, setLoading] = useState(false);

  const [selectedBracketId, setSelectedBracketId] = useState<number | null>(
    null,
  );
  const [bracketDetail, setBracketDetail] = useState<BracketDetail | null>(
    null,
  );
  const [detailLoading, setDetailLoading] = useState(false);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [formData, setFormData] = useState<BracketFormData>(defaultFormData);
  const [saving, setSaving] = useState(false);

  const [createTeams, setCreateTeams] = useState<CreateModalTeam[]>([]);
  const [createScores, setCreateScores] = useState<CreateModalScore[]>([]);
  const [createRankings, setCreateRankings] = useState<CreateModalRanking[]>(
    [],
  );
  const [createAssigned, setCreateAssigned] = useState<AssignedTeam[]>([]);
  const [createDataLoading, setCreateDataLoading] = useState(false);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<number>>(
    new Set(),
  );

  const [generatingEntries, setGeneratingEntries] = useState(false);
  const [generatingGames, setGeneratingGames] = useState(false);

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

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

  useEffect(() => {
    if (!showCreateModal || !selectedEventId) {
      return;
    }
    let cancelled = false;
    setCreateDataLoading(true);
    setSelectedTeamIds(new Set());
    Promise.all([
      fetch(`/teams/event/${selectedEventId}`, { credentials: 'include' }),
      fetch(`/seeding/scores/event/${selectedEventId}`, {
        credentials: 'include',
      }),
      fetch(`/seeding/rankings/event/${selectedEventId}`, {
        credentials: 'include',
      }),
      fetch(`/brackets/event/${selectedEventId}/assigned-teams`, {
        credentials: 'include',
      }),
    ])
      .then(async ([teamsRes, scoresRes, rankingsRes, assignedRes]) => {
        if (cancelled) return;
        if (!teamsRes.ok) throw new Error('Failed to fetch teams');
        if (!scoresRes.ok) throw new Error('Failed to fetch scores');
        if (!rankingsRes.ok) throw new Error('Failed to fetch rankings');
        if (!assignedRes.ok) throw new Error('Failed to fetch assigned teams');
        const [teams, scores, rankings, assigned] = await Promise.all([
          teamsRes.json(),
          scoresRes.json(),
          rankingsRes.json(),
          assignedRes.json(),
        ]);
        if (cancelled) return;
        setCreateTeams(teams);
        setCreateScores(scores);
        setCreateRankings(rankings);
        setCreateAssigned(assigned);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('Error loading create modal data:', err);
          toast.error(
            err instanceof Error ? err.message : 'Failed to load teams',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setCreateDataLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showCreateModal, selectedEventId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId) return;

    if (!formData.name.trim()) {
      toast.error('Bracket name is required');
      return;
    }

    const teamIds = Array.from(selectedTeamIds);
    if (teamIds.length === 0) {
      toast.error('Select at least one team for the bracket');
      return;
    }

    setSaving(true);
    try {
      const response = await fetch('/brackets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          event_id: selectedEventId,
          name: formData.name.trim(),
          team_ids: teamIds,
        }),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        if (response.status === 409 && data.conflicts?.length) {
          const names = data.conflicts
            .map(
              (c: { team_name: string; bracket_name: string }) =>
                `${c.team_name} (in ${c.bracket_name})`,
            )
            .join(', ');
          throw new Error(
            `Teams already in another bracket: ${names}. Remove them from selection.`,
          );
        }
        throw new Error(data.error || 'Failed to create bracket');
      }

      toast.success('Bracket created!');
      setShowCreateModal(false);
      setFormData(defaultFormData);
      setSelectedTeamIds(new Set());
      await fetchBrackets();
      if (data.id) {
        setSelectedBracketId(data.id);
      }
    } catch (error) {
      console.error('Error creating bracket:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to create bracket',
      );
    } finally {
      setSaving(false);
    }
  };

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

  const handleGenerateGames = async () => {
    if (!bracketDetail) return;

    const hasGames = bracketDetail.games.length > 0;
    if (hasGames) {
      const confirmed = await confirm({
        title: 'Danger: Regenerate Games',
        message:
          'This will clear ALL bracket games, removing all progress and all recorded games. This cannot be undone. Continue?',
        confirmText: 'Clear ALL Games and Regenerate',
        confirmStyle: 'danger',
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

  const handleOpenEditModal = () => {
    if (!bracketDetail) return;
    setFormData({
      name: bracketDetail.name,
      bracket_size: bracketDetail.bracket_size,
      actual_team_count: bracketDetail.actual_team_count?.toString() || '',
    });
    setShowEditModal(true);
  };

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

  const renderAdminActions = () => {
    if (!bracketDetail) return null;
    return (
      <>
        <button className="btn btn-secondary" onClick={handleOpenEditModal}>
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
      </>
    );
  };

  const renderEntriesActions = () => {
    if (!bracketDetail || bracketDetail.entries.length > 0) return null;
    return (
      <button
        className="btn btn-primary"
        onClick={handleGenerateEntries}
        disabled={generatingEntries}
      >
        {generatingEntries ? 'Generating...' : 'Generate from Seeding'}
      </button>
    );
  };

  const renderGamesActions = () => {
    if (!bracketDetail) return null;
    return (
      <button
        className={`btn ${bracketDetail.games.length > 0 ? 'btn-danger' : 'btn-primary'}`}
        onClick={handleGenerateGames}
        disabled={generatingGames || bracketDetail.entries.length === 0}
        title={
          bracketDetail.entries.length === 0 ? 'Generate entries first' : ''
        }
      >
        {generatingGames
          ? 'Generating...'
          : bracketDetail.games.length > 0
            ? 'Clear ALL Games and Regenerate'
            : 'Generate Games'}
      </button>
    );
  };

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
            ) : (
              <BracketListTable
                brackets={brackets}
                onSelect={setSelectedBracketId}
                onDelete={handleDelete}
              />
            )}
          </div>
        </>
      )}

      {/* Bracket Detail View */}
      {selectedBracketId && (
        <>
          {detailLoading ? (
            <p>Loading bracket details...</p>
          ) : bracketDetail ? (
            <BracketDetailView
              bracketDetail={bracketDetail}
              onBack={() => {
                setSelectedBracketId(null);
                setBracketDetail(null);
              }}
              adminActions={renderAdminActions()}
              entriesActions={renderEntriesActions()}
              gamesActions={renderGamesActions()}
            />
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
            style={{ maxWidth: '90vw', width: '800px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="close" onClick={() => setShowCreateModal(false)}>
              &times;
            </span>
            <h3>Create Bracket</h3>
            <p
              style={{
                color: 'var(--secondary-color)',
                marginBottom: '1rem',
              }}
            >
              Select teams for this bracket. Bracket size and byes are computed
              automatically.
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

              {createDataLoading ? (
                <p>Loading teams...</p>
              ) : createTeams.length === 0 ? (
                <p style={{ color: 'var(--secondary-color)' }}>
                  No teams in this event. Add teams first.
                </p>
              ) : (
                <>
                  <div className="form-group">
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: '0.5rem',
                      }}
                    >
                      <label style={{ marginBottom: 0 }}>Select Teams</label>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => {
                          const availableTeamIds = createTeams
                            .filter(
                              (team) =>
                                !createAssigned.some(
                                  (assigned) => assigned.team_id === team.id,
                                ),
                            )
                            .map((team) => team.id);
                          setSelectedTeamIds(new Set(availableTeamIds));
                        }}
                        disabled={createTeams.length === 0}
                      >
                        Select All Available
                      </button>
                    </div>
                    <div
                      className="table-responsive"
                      style={{ maxHeight: '300px', overflow: 'auto' }}
                    >
                      <table className="bracket-create-teams-table">
                        <thead>
                          <tr>
                            <th style={{ width: '40px' }}>Select</th>
                            <th>Team #</th>
                            <th>Team Name</th>
                            {Array.from(
                              {
                                length: selectedEvent?.seeding_rounds ?? 3,
                              },
                              (_, i) => (
                                <th key={i}>R{i + 1}</th>
                              ),
                            )}
                            <th>Seed Avg</th>
                            <th>Rank</th>
                            <th>Raw</th>
                            <th>Assigned</th>
                          </tr>
                        </thead>
                        <tbody>
                          {[...createTeams]
                            .sort((a, b) => {
                              const rankA = createRankings.find(
                                (r) => r.team_id === a.id,
                              )?.seed_rank;
                              const rankB = createRankings.find(
                                (r) => r.team_id === b.id,
                              )?.seed_rank;
                              if (rankA == null && rankB == null)
                                return a.team_number - b.team_number;
                              if (rankA == null) return 1;
                              if (rankB == null) return -1;
                              return rankA - rankB;
                            })
                            .map((team) => {
                              const scoreMap = new Map<number, number | null>();
                              for (const s of createScores) {
                                if (s.team_id === team.id)
                                  scoreMap.set(s.round_number, s.score);
                              }
                              const ranking = createRankings.find(
                                (r) => r.team_id === team.id,
                              );
                              const assigned = createAssigned.find(
                                (a) => a.team_id === team.id,
                              );
                              const isSelected = selectedTeamIds.has(team.id);
                              const hasOverlap = isSelected && !!assigned;
                              return (
                                <tr
                                  key={team.id}
                                  className={
                                    hasOverlap ? 'bracket-create-overlap' : ''
                                  }
                                >
                                  <td>
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={(e) => {
                                        setSelectedTeamIds((prev) => {
                                          const next = new Set(prev);
                                          if (e.target.checked) {
                                            next.add(team.id);
                                          } else {
                                            next.delete(team.id);
                                          }
                                          return next;
                                        });
                                      }}
                                      disabled={!!assigned}
                                      title={
                                        assigned
                                          ? `${team.team_name} is already in ${assigned.bracket_name}`
                                          : undefined
                                      }
                                    />
                                  </td>
                                  <td>{team.team_number}</td>
                                  <td>{team.team_name}</td>
                                  {Array.from(
                                    {
                                      length:
                                        selectedEvent?.seeding_rounds ?? 3,
                                    },
                                    (_, i) => (
                                      <td key={i}>
                                        {scoreMap.get(i + 1) ?? '—'}
                                      </td>
                                    ),
                                  )}
                                  <td>
                                    {ranking?.seed_average != null
                                      ? ranking.seed_average.toFixed(2)
                                      : '—'}
                                  </td>
                                  <td>{ranking?.seed_rank ?? '—'}</td>
                                  <td>
                                    {ranking?.raw_seed_score != null
                                      ? ranking.raw_seed_score.toFixed(4)
                                      : '—'}
                                  </td>
                                  <td>
                                    {assigned ? (
                                      <span
                                        className="bracket-create-assigned"
                                        title={`In ${assigned.bracket_name}`}
                                      >
                                        {assigned.bracket_name}
                                      </span>
                                    ) : (
                                      '—'
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {selectedTeamIds.size > 0 && (
                    <div
                      className="bracket-create-summary"
                      style={{
                        marginBottom: '1rem',
                        padding: '0.5rem',
                        background: 'var(--surface-color)',
                        borderRadius: '4px',
                      }}
                    >
                      <strong>Selected:</strong> {selectedTeamIds.size} teams
                      {' · '}
                      <strong>Bracket size:</strong>{' '}
                      {nextPowerOfTwo(selectedTeamIds.size)}{' '}
                      <strong>Byes:</strong>{' '}
                      {nextPowerOfTwo(selectedTeamIds.size) -
                        selectedTeamIds.size}
                    </div>
                  )}

                  {Array.from(selectedTeamIds).some((id) =>
                    createAssigned.some((a) => a.team_id === id),
                  ) && (
                    <div
                      className="bracket-create-overlap-warning"
                      style={{
                        color: 'var(--danger-color)',
                        marginBottom: '1rem',
                        fontSize: '0.9rem',
                      }}
                    >
                      Some selected teams are already in another bracket. Remove
                      them to continue.
                    </div>
                  )}
                </>
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
                  onClick={() => setShowCreateModal(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={
                    saving ||
                    createDataLoading ||
                    selectedTeamIds.size === 0 ||
                    Array.from(selectedTeamIds).some((id) =>
                      createAssigned.some((a) => a.team_id === id),
                    )
                  }
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
