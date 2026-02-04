import React, { useState, useEffect, useCallback } from 'react';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import '../Modal.css';
import './QueueTab.css';

interface QueueItem {
  id: number;
  event_id: number;
  bracket_game_id: number | null;
  seeding_team_id: number | null;
  seeding_round: number | null;
  queue_type: 'seeding' | 'bracket';
  queue_position: number;
  status: QueueStatus;
  table_number: number | null;
  called_at: string | null;
  created_at: string;
  // Bracket game info
  game_number: number | null;
  round_name: string | null;
  bracket_side: string | null;
  team1_number: number | null;
  team1_name: string | null;
  team1_display: string | null;
  team2_number: number | null;
  team2_name: string | null;
  team2_display: string | null;
  // Seeding team info
  seeding_team_number: number | null;
  seeding_team_name: string | null;
  seeding_team_display: string | null;
}

interface Bracket {
  id: number;
  name: string;
  bracket_size: number;
  status: string;
}

interface BracketGame {
  id: number;
  game_number: number;
  round_name: string | null;
  bracket_side: string | null;
  team1_id: number | null;
  team2_id: number | null;
  team1_number: number | null;
  team1_name: string | null;
  team2_number: number | null;
  team2_name: string | null;
  status: string;
}

interface Team {
  id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

type QueueStatus =
  | 'queued'
  | 'called'
  | 'in_progress'
  | 'completed'
  | 'skipped';
type QueueType = 'seeding' | 'bracket';

interface QueueTabProps {
  selectedEventId: number | null;
  seedingRounds: number;
}

const STATUS_OPTIONS: { value: QueueStatus | 'all'; label: string }[] = [
  { value: 'queued', label: 'Pending' },
  { value: 'called', label: 'Called' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'all', label: 'All Statuses' },
];

const TYPE_OPTIONS: { value: QueueType | 'all'; label: string }[] = [
  { value: 'all', label: 'All Types' },
  { value: 'seeding', label: 'Seeding' },
  { value: 'bracket', label: 'Bracket' },
];

function getTypeClass(type: QueueType): string {
  return `queue-type-${type}`;
}

function getStatusClass(status: QueueStatus): string {
  return `queue-status-${status.replace('_', '-')}`;
}

const STATUS_LABELS: Record<QueueStatus, string> = {
  queued: 'Pending',
  called: 'Called',
  in_progress: 'In Progress',
  completed: 'Completed',
  skipped: 'Skipped',
};

export default function QueueTab({
  selectedEventId,
  seedingRounds,
}: QueueTabProps) {
  // Queue state
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<QueueStatus | 'all'>(
    'queued',
  );
  const [filterType, setFilterType] = useState<QueueType | 'all'>('all');

  // Populate from bracket state
  const [showPopulateModal, setShowPopulateModal] = useState(false);
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [selectedBracketId, setSelectedBracketId] = useState<number | null>(
    null,
  );
  const [populating, setPopulating] = useState(false);

  // Populate from seeding state
  const [showPopulateSeedingModal, setShowPopulateSeedingModal] =
    useState(false);
  const [populatingSeeding, setPopulatingSeeding] = useState(false);

  // Add seeding modal state
  const [showAddSeedingModal, setShowAddSeedingModal] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [selectedRound, setSelectedRound] = useState<number>(1);
  const [addingSeeding, setAddingSeeding] = useState(false);

  // Add bracket game modal state
  const [showAddBracketModal, setShowAddBracketModal] = useState(false);
  const [bracketGames, setBracketGames] = useState<BracketGame[]>([]);
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [addingBracket, setAddingBracket] = useState(false);
  const [addBracketSelectedBracketId, setAddBracketSelectedBracketId] =
    useState<number | null>(null);

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  // Fetch queue
  const fetchQueue = useCallback(async () => {
    if (!selectedEventId) {
      setQueue([]);
      return;
    }

    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus !== 'all') {
        params.append('status', filterStatus);
      }
      if (filterType !== 'all') {
        params.append('queue_type', filterType);
      }

      const url = `/queue/event/${selectedEventId}${params.toString() ? `?${params}` : ''}`;
      const response = await fetch(url, { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Failed to fetch queue');
      }
      const data: QueueItem[] = await response.json();
      setQueue(data);
    } catch (error) {
      console.error('Error fetching queue:', error);
      toast.error('Failed to load queue');
    } finally {
      setLoading(false);
    }
  }, [selectedEventId, filterStatus, filterType]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  // Fetch brackets for populate modal
  const fetchBrackets = useCallback(async () => {
    if (!selectedEventId) return;

    try {
      const response = await fetch(`/brackets/event/${selectedEventId}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch brackets');
      const data: Bracket[] = await response.json();
      setBrackets(data);
      if (data.length > 0) {
        setSelectedBracketId(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching brackets:', error);
    }
  }, [selectedEventId]);

  // Fetch teams for add seeding modal
  const fetchTeams = useCallback(async () => {
    if (!selectedEventId) return;

    try {
      const response = await fetch(`/teams/event/${selectedEventId}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch teams');
      const data: Team[] = await response.json();
      setTeams(data);
      if (data.length > 0) {
        setSelectedTeamId(data[0].id);
      }
    } catch (error) {
      console.error('Error fetching teams:', error);
    }
  }, [selectedEventId]);

  // Fetch bracket games for add bracket modal
  const fetchBracketGames = useCallback(async (bracketId: number) => {
    try {
      const response = await fetch(`/brackets/${bracketId}/games`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch bracket games');
      const data: BracketGame[] = await response.json();
      // Filter to games with both teams assigned
      const eligibleGames = data.filter(
        (g) => g.team1_id && g.team2_id && g.status !== 'completed',
      );
      setBracketGames(eligibleGames);
      if (eligibleGames.length > 0) {
        setSelectedGameId(eligibleGames[0].id);
      } else {
        setSelectedGameId(null);
      }
    } catch (error) {
      console.error('Error fetching bracket games:', error);
    }
  }, []);

  // Handle populate from bracket
  const handlePopulateFromBracket = async () => {
    if (!selectedEventId || !selectedBracketId) return;

    const confirmed = await confirm({
      title: 'Populate Queue from Bracket',
      message:
        'This will replace the current queue with games from the selected bracket. Continue?',
      confirmText: 'Populate',
      confirmStyle: 'warning',
    });

    if (!confirmed) return;

    setPopulating(true);
    try {
      const response = await fetch('/queue/populate-from-bracket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          event_id: selectedEventId,
          bracket_id: selectedBracketId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to populate queue');
      }

      const data = await response.json();
      toast.success(`Added ${data.created} games to the queue`);
      setShowPopulateModal(false);
      await fetchQueue();
    } catch (error) {
      console.error('Error populating queue:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to populate queue',
      );
    } finally {
      setPopulating(false);
    }
  };

  // Handle populate from seeding
  const handlePopulateFromSeeding = async () => {
    if (!selectedEventId) return;

    const confirmed = await confirm({
      title: 'Populate Queue from Seeding',
      message:
        'This will replace the current queue with all unplayed seeding rounds. Continue?',
      confirmText: 'Populate',
      confirmStyle: 'warning',
    });

    if (!confirmed) return;

    setPopulatingSeeding(true);
    try {
      const response = await fetch('/queue/populate-from-seeding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          event_id: selectedEventId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to populate queue');
      }

      const data = await response.json();
      toast.success(`Added ${data.created} seeding rounds to the queue`);
      setShowPopulateSeedingModal(false);
      await fetchQueue();
    } catch (error) {
      console.error('Error populating queue from seeding:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to populate queue',
      );
    } finally {
      setPopulatingSeeding(false);
    }
  };

  // Handle add seeding round
  const handleAddSeeding = async () => {
    if (!selectedEventId || !selectedTeamId) return;

    setAddingSeeding(true);
    try {
      const response = await fetch('/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          event_id: selectedEventId,
          queue_type: 'seeding',
          seeding_team_id: selectedTeamId,
          seeding_round: selectedRound,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add to queue');
      }

      toast.success('Seeding round added to queue');
      setShowAddSeedingModal(false);
      await fetchQueue();
    } catch (error) {
      console.error('Error adding seeding:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to add seeding round',
      );
    } finally {
      setAddingSeeding(false);
    }
  };

  // Handle add bracket game
  const handleAddBracketGame = async () => {
    if (!selectedEventId || !selectedGameId) return;

    setAddingBracket(true);
    try {
      const response = await fetch('/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          event_id: selectedEventId,
          queue_type: 'bracket',
          bracket_game_id: selectedGameId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to add to queue');
      }

      toast.success('Bracket game added to queue');
      setShowAddBracketModal(false);
      await fetchQueue();
    } catch (error) {
      console.error('Error adding bracket game:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to add bracket game',
      );
    } finally {
      setAddingBracket(false);
    }
  };

  // Handle move up/down
  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const newQueue = [...queue];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= newQueue.length) return;

    // Swap items
    [newQueue[index], newQueue[targetIndex]] = [
      newQueue[targetIndex],
      newQueue[index],
    ];

    // Update positions
    const items = newQueue.map((item, i) => ({
      id: item.id,
      queue_position: i + 1,
    }));

    // Optimistically update UI
    setQueue(newQueue.map((item, i) => ({ ...item, queue_position: i + 1 })));

    try {
      const response = await fetch('/queue/reorder', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ items }),
      });

      if (!response.ok) {
        throw new Error('Failed to reorder queue');
      }
    } catch (error) {
      console.error('Error reordering queue:', error);
      toast.error('Failed to reorder queue');
      // Revert on error
      await fetchQueue();
    }
  };

  // Handle call toggle (between queued and called)
  const handleCallToggle = async (item: QueueItem) => {
    const newStatus: QueueStatus =
      item.status === 'called' ? 'queued' : 'called';

    try {
      let response;

      if (newStatus === 'called') {
        // Use the special call endpoint to record called_at
        response = await fetch(`/queue/${item.id}/call`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        });
      } else {
        response = await fetch(`/queue/${item.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status: newStatus }),
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update status');
      }

      // Optimistically update
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: newStatus } : q)),
      );
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to update status',
      );
    }
  };

  // Handle delete
  const handleDelete = async (item: QueueItem) => {
    const confirmed = await confirm({
      title: 'Remove from Queue',
      message: 'Are you sure you want to remove this item from the queue?',
      confirmText: 'Remove',
      confirmStyle: 'danger',
    });

    if (!confirmed) return;

    try {
      const response = await fetch(`/queue/${item.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok && response.status !== 204) {
        throw new Error('Failed to remove from queue');
      }

      toast.success('Removed from queue');
      setQueue((prev) => prev.filter((q) => q.id !== item.id));
    } catch (error) {
      console.error('Error removing from queue:', error);
      toast.error('Failed to remove from queue');
    }
  };

  // Render item details
  const renderItemDetails = (item: QueueItem) => {
    if (item.queue_type === 'seeding') {
      const teamName =
        item.seeding_team_name || item.seeding_team_display || '';
      return (
        <div className="queue-game-details">
          <span className="queue-game-title">
            #{item.seeding_team_number} {teamName}
          </span>
          <span className="queue-game-teams">Round {item.seeding_round}</span>
        </div>
      );
    }

    // Bracket game
    const team1Name = item.team1_name || item.team1_display || '';
    const team2Name = item.team2_name || item.team2_display || '';
    return (
      <div className="queue-game-details">
        <span className="queue-game-title">
          #{item.team1_number} {team1Name} vs #{item.team2_number} {team2Name}
        </span>
        <span className="queue-game-teams">
          Game {item.game_number}
          {item.round_name && ` - ${item.round_name}`}
        </span>
      </div>
    );
  };

  // No event selected
  if (!selectedEventId) {
    return (
      <div className="queue-tab">
        <div className="card">
          <p style={{ color: 'var(--secondary-color)' }}>
            Select an event to manage the queue.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="queue-tab">
      {/* Controls */}
      <div className="queue-controls">
        <div className="queue-controls-left">
          <button
            className="btn btn-primary"
            onClick={() => {
              fetchBrackets();
              setShowPopulateModal(true);
            }}
          >
            Populate from Bracket
          </button>
          <button
            className="btn btn-primary"
            onClick={() => setShowPopulateSeedingModal(true)}
          >
            Populate from Seeding
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              fetchTeams();
              setShowAddSeedingModal(true);
            }}
          >
            + Add Seeding
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              fetchBrackets();
              setShowAddBracketModal(true);
            }}
          >
            + Add Bracket Game
          </button>
        </div>
        <div className="queue-controls-right">
          <select
            className="field-input queue-filter"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as QueueType | 'all')}
          >
            {TYPE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            className="field-input queue-filter"
            value={filterStatus}
            onChange={(e) =>
              setFilterStatus(e.target.value as QueueStatus | 'all')
            }
          >
            {STATUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Queue table */}
      <div className="card">
        {loading ? (
          <p>Loading queue...</p>
        ) : queue.length === 0 ? (
          <p style={{ color: 'var(--secondary-color)' }}>
            {filterStatus === 'all' && filterType === 'all'
              ? 'Queue is empty. Use "Populate from Bracket" or add items manually.'
              : 'No queue items match the current filters.'}
          </p>
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{ width: '50px' }}>#</th>
                <th style={{ width: '80px' }}>Type</th>
                <th>Details</th>
                <th style={{ width: '100px' }}>Status</th>
                <th style={{ width: '200px' }}>Actions</th>
                <th style={{ width: '60px' }}>Order</th>
              </tr>
            </thead>
            <tbody>
              {queue.map((item, index) => (
                <tr key={item.id}>
                  <td className="queue-position">{item.queue_position}</td>
                  <td>
                    <span
                      className={`queue-type-badge ${getTypeClass(item.queue_type)}`}
                    >
                      {item.queue_type}
                    </span>
                  </td>
                  <td>{renderItemDetails(item)}</td>
                  <td>
                    <span
                      className={`queue-status-badge ${getStatusClass(item.status)}`}
                    >
                      {STATUS_LABELS[item.status]}
                    </span>
                  </td>
                  <td>
                    <div className="queue-actions">
                      {(item.status === 'queued' ||
                        item.status === 'called') && (
                        <button
                          className={`btn ${item.status === 'queued' ? 'btn-success' : 'btn-secondary'}`}
                          onClick={() => handleCallToggle(item)}
                        >
                          {item.status === 'queued' ? 'Call' : 'Uncall'}
                        </button>
                      )}
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDelete(item)}
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                  <td>
                    <div className="reorder-buttons">
                      <button
                        className="btn btn-secondary reorder-btn"
                        onClick={() => handleMove(index, 'up')}
                        disabled={index === 0}
                        title="Move up"
                      >
                        ▲
                      </button>
                      <button
                        className="btn btn-secondary reorder-btn"
                        onClick={() => handleMove(index, 'down')}
                        disabled={index === queue.length - 1}
                        title="Move down"
                      >
                        ▼
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="queue-summary">
          {queue.length} item{queue.length !== 1 ? 's' : ''} in queue
          {(filterStatus !== 'all' || filterType !== 'all') && ' (filtered)'}
        </div>
      </div>

      {/* Populate from Bracket Modal */}
      {showPopulateModal && (
        <div className="modal show" onClick={() => setShowPopulateModal(false)}>
          <div
            className="modal-content"
            style={{ maxWidth: '500px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="close" onClick={() => setShowPopulateModal(false)}>
              &times;
            </span>
            <h3>Populate Queue from Bracket</h3>
            <p
              style={{
                color: 'var(--secondary-color)',
                marginBottom: '1.5rem',
              }}
            >
              This will replace the current queue with eligible games from the
              selected bracket. Games must have both teams assigned.
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
                    onChange={(e) =>
                      setSelectedBracketId(Number(e.target.value))
                    }
                  >
                    {brackets.map((bracket) => (
                      <option key={bracket.id} value={bracket.id}>
                        {bracket.name} ({bracket.bracket_size} teams)
                      </option>
                    ))}
                  </select>
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
                    onClick={() => setShowPopulateModal(false)}
                    disabled={populating}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handlePopulateFromBracket}
                    disabled={populating || !selectedBracketId}
                  >
                    {populating ? 'Populating...' : 'Populate Queue'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Populate from Seeding Modal */}
      {showPopulateSeedingModal && (
        <div
          className="modal show"
          onClick={() => setShowPopulateSeedingModal(false)}
        >
          <div
            className="modal-content"
            style={{ maxWidth: '500px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span
              className="close"
              onClick={() => setShowPopulateSeedingModal(false)}
            >
              &times;
            </span>
            <h3>Populate Queue from Seeding</h3>
            <p
              style={{
                color: 'var(--secondary-color)',
                marginBottom: '1.5rem',
              }}
            >
              This will replace the current queue with all unplayed seeding
              rounds (team + round combinations that don&apos;t have a score
              yet).
            </p>

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
                onClick={() => setShowPopulateSeedingModal(false)}
                disabled={populatingSeeding}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handlePopulateFromSeeding}
                disabled={populatingSeeding}
              >
                {populatingSeeding ? 'Populating...' : 'Populate Queue'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Seeding Modal */}
      {showAddSeedingModal && (
        <div
          className="modal show"
          onClick={() => setShowAddSeedingModal(false)}
        >
          <div
            className="modal-content"
            style={{ maxWidth: '500px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span
              className="close"
              onClick={() => setShowAddSeedingModal(false)}
            >
              &times;
            </span>
            <h3>Add Seeding Round to Queue</h3>
            <p
              style={{
                color: 'var(--secondary-color)',
                marginBottom: '1.5rem',
              }}
            >
              Add a specific team&apos;s seeding round to the queue.
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
                    onClick={() => setShowAddSeedingModal(false)}
                    disabled={addingSeeding}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleAddSeeding}
                    disabled={addingSeeding || !selectedTeamId}
                  >
                    {addingSeeding ? 'Adding...' : 'Add to Queue'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Add Bracket Game Modal */}
      {showAddBracketModal && (
        <div
          className="modal show"
          onClick={() => setShowAddBracketModal(false)}
        >
          <div
            className="modal-content"
            style={{ maxWidth: '600px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span
              className="close"
              onClick={() => setShowAddBracketModal(false)}
            >
              &times;
            </span>
            <h3>Add Bracket Game to Queue</h3>
            <p
              style={{
                color: 'var(--secondary-color)',
                marginBottom: '1.5rem',
              }}
            >
              Add a specific bracket game to the queue.
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
                    value={addBracketSelectedBracketId ?? ''}
                    onChange={(e) => {
                      const bracketId = Number(e.target.value);
                      setAddBracketSelectedBracketId(bracketId);
                      if (bracketId) {
                        fetchBracketGames(bracketId);
                      } else {
                        setBracketGames([]);
                        setSelectedGameId(null);
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

                {addBracketSelectedBracketId && (
                  <div className="form-group">
                    <label htmlFor="game-select">Select Game</label>
                    {bracketGames.length === 0 ? (
                      <p
                        style={{
                          color: 'var(--secondary-color)',
                          fontSize: '0.9rem',
                        }}
                      >
                        No eligible games found (games must have both teams
                        assigned and not be completed).
                      </p>
                    ) : (
                      <select
                        id="game-select"
                        className="field-input"
                        value={selectedGameId ?? ''}
                        onChange={(e) =>
                          setSelectedGameId(Number(e.target.value))
                        }
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
                    onClick={() => setShowAddBracketModal(false)}
                    disabled={addingBracket}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={handleAddBracketGame}
                    disabled={addingBracket || !selectedGameId}
                  >
                    {addingBracket ? 'Adding...' : 'Add to Queue'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
