import { useMemo, useState } from 'react';
import { UnifiedTable } from '../table';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import { formatCalledAt } from '../../utils/dateUtils';
import { apiFetch, apiSend } from '../../utils/apiClient';
import {
  QUEUE_STATUSES,
  QUEUE_STATUS_LABELS,
  QUEUE_TYPES,
  QUEUE_TYPE_LABELS,
  getNextQueueStatus,
  getQueueRowStatusClass,
  getQueueStatusClass,
  type QueueStatus,
  type QueueType,
} from '@shared/domain/queue';
import '../Modal.css';
import './QueueTab.css';
import {
  getTypeClass,
  renderTeamNumber as renderTeamNumberHelper,
  sortQueue,
  type QueueItem,
  type SortDirection,
  type SortField,
} from './queue/queueHelpers';
import { useQueueData } from './queue/useQueueData';
import { useQueueBrackets } from './queue/useQueueBrackets';
import { useEventTeams } from './queue/useEventTeams';
import { PopulateFromBracketModal } from './queue/PopulateFromBracketModal';
import { PopulateFromSeedingModal } from './queue/PopulateFromSeedingModal';
import { AddSeedingModal } from './queue/AddSeedingModal';
import { AddBracketGameModal } from './queue/AddBracketGameModal';

const TYPE_OPTIONS: { value: QueueType | 'all'; label: string }[] = [
  { value: 'all', label: 'All Types' },
  ...QUEUE_TYPES.map((value) => ({ value, label: QUEUE_TYPE_LABELS[value] })),
];

export default function QueueTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;
  const seedingRounds = selectedEvent?.seeding_rounds ?? 3;

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  const [filterStatuses, setFilterStatuses] = useState<QueueStatus[]>([
    ...QUEUE_STATUSES,
  ]);
  const [filterType, setFilterType] = useState<QueueType | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('gameNumber');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  const { queue, setQueue, loading, refetch } = useQueueData(
    selectedEventId,
    filterStatuses,
    filterType,
    toast.error,
  );
  const { brackets, bracketGames, setBracketGames, loadBrackets, loadGames } =
    useQueueBrackets(selectedEventId);
  const { teams, loadTeams } = useEventTeams(selectedEventId);

  const [showPopulateModal, setShowPopulateModal] = useState(false);
  const [showPopulateSeedingModal, setShowPopulateSeedingModal] =
    useState(false);
  const [showAddSeedingModal, setShowAddSeedingModal] = useState(false);
  const [showAddBracketModal, setShowAddBracketModal] = useState(false);

  const sortedQueue = useMemo(
    () => sortQueue(queue, sortField, sortDirection),
    [queue, sortField, sortDirection],
  );

  const handlePopulateFromBracket = async (bracketId: number) => {
    if (!selectedEventId) return;
    const confirmed = await confirm({
      title: 'Populate Queue from Bracket',
      message: 'This will completely clear the existing queue. Continue?',
      confirmText: 'Populate',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;
    try {
      const data = await apiSend<{ created: number }>(
        'POST',
        '/queue/populate-from-bracket',
        { event_id: selectedEventId, bracket_id: bracketId },
      );
      toast.success(`Added ${data.created} games to the queue`);
      setShowPopulateModal(false);
      await refetch();
    } catch (error) {
      console.error('Error populating queue:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to populate queue',
      );
    }
  };

  const handlePopulateFromSeeding = async () => {
    if (!selectedEventId) return;
    const confirmed = await confirm({
      title: 'Populate Queue from Seeding',
      message: 'This will completely clear the existing queue. Continue?',
      confirmText: 'Populate',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;
    try {
      const data = await apiSend<{ created: number }>(
        'POST',
        '/queue/populate-from-seeding',
        { event_id: selectedEventId },
      );
      toast.success(`Added ${data.created} seeding rounds to the queue`);
      setShowPopulateSeedingModal(false);
      await refetch();
    } catch (error) {
      console.error('Error populating queue from seeding:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to populate queue',
      );
    }
  };

  const handleAddSeeding = async (teamId: number, round: number) => {
    if (!selectedEventId) return;
    const confirmed = await confirm({
      title: 'Add Seeding Round',
      message:
        'Games are automatically queued, are you sure you need to add this? Have you double checked the list?',
      confirmText: 'Add',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;
    try {
      await apiSend('POST', '/queue', {
        event_id: selectedEventId,
        queue_type: 'seeding',
        seeding_team_id: teamId,
        seeding_round: round,
      });
      toast.success('Seeding round added to queue');
      setShowAddSeedingModal(false);
      await refetch();
    } catch (error) {
      console.error('Error adding seeding:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to add seeding round',
      );
    }
  };

  const handleAddBracketGame = async (gameId: number) => {
    if (!selectedEventId) return;
    const confirmed = await confirm({
      title: 'Add Bracket Game',
      message:
        'Games are automatically queued, are you sure you need to add this? Have you double checked the list?',
      confirmText: 'Add',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;
    try {
      await apiSend('POST', '/queue', {
        event_id: selectedEventId,
        queue_type: 'bracket',
        bracket_game_id: gameId,
      });
      toast.success('Bracket game added to queue');
      setShowAddBracketModal(false);
      await refetch();
    } catch (error) {
      console.error('Error adding bracket game:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to add bracket game',
      );
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    const newQueue = [...queue];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newQueue.length) return;

    [newQueue[index], newQueue[targetIndex]] = [
      newQueue[targetIndex],
      newQueue[index],
    ];
    const items = newQueue.map((item, i) => ({
      id: item.id,
      queue_position: i + 1,
    }));
    setQueue(newQueue.map((item, i) => ({ ...item, queue_position: i + 1 })));
    try {
      await apiSend('PATCH', '/queue/reorder', { items });
    } catch (error) {
      console.error('Error reordering queue:', error);
      toast.error('Failed to reorder queue');
      await refetch();
    }
  };

  const handleFlowStep = async (
    item: QueueItem,
    direction: 'next' | 'prev',
  ) => {
    const idx = QUEUE_STATUSES.indexOf(item.status);
    if (idx < 0) return;
    const delta = direction === 'next' ? 1 : -1;
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= QUEUE_STATUSES.length) return;
    const targetStatus = QUEUE_STATUSES[nextIdx]!;

    try {
      let response: Response;
      if (
        direction === 'next' &&
        item.status === 'queued' &&
        targetStatus === 'called'
      ) {
        response = await apiFetch(`/queue/${item.id}/call`, {
          method: 'PATCH',
          json: {},
        });
      } else {
        response = await apiFetch(`/queue/${item.id}`, {
          method: 'PATCH',
          json: { status: targetStatus },
        });
      }

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to update status');
      }

      const updatedItem = (await response.json()) as QueueItem;
      setQueue((prev) =>
        prev.map((q) =>
          q.id === item.id
            ? {
                ...q,
                status: (updatedItem.status as QueueStatus) ?? targetStatus,
                called_at:
                  targetStatus === 'queued'
                    ? null
                    : (updatedItem.called_at ?? q.called_at),
                table_number:
                  targetStatus === 'queued'
                    ? null
                    : (updatedItem.table_number ?? q.table_number),
              }
            : q,
        ),
      );
    } catch (error) {
      console.error('Error updating status:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to update status',
      );
    }
  };

  const renderItemDetails = (item: QueueItem) => {
    if (item.queue_type === 'seeding') {
      const teamName = item.seeding_team_name || '';
      return (
        <div className="queue-game-details">
          <span className="queue-game-title">{teamName}</span>
          <span className="queue-game-teams">Round {item.seeding_round}</span>
        </div>
      );
    }
    const team1Name = item.team1_name || '';
    const team2Name = item.team2_name || '';
    return (
      <div className="queue-game-details">
        <span className="queue-game-title">
          {team1Name} vs {team2Name}
        </span>
        <span className="queue-game-teams">
          {item.bracket_name && `${item.bracket_name} · `}Game{' '}
          {item.game_number}
          {item.round_name && ` - ${item.round_name}`}
        </span>
      </div>
    );
  };

  const toggleStatus = (status: QueueStatus) => {
    setFilterStatuses((prev) => {
      const next = prev.includes(status)
        ? prev.filter((s) => s !== status)
        : [...prev, status];
      return next.length === 0 ? [...QUEUE_STATUSES] : next;
    });
  };

  const toggleAllStatuses = () => {
    if (filterStatuses.length === QUEUE_STATUSES.length) {
      setFilterStatuses(['queued', 'called', 'arrived', 'on_table']);
    } else {
      setFilterStatuses([...QUEUE_STATUSES]);
    }
  };

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection('asc');
  };

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
      <div className="queue-controls">
        <div className="queue-controls-left">
          <button
            className="btn btn-primary"
            onClick={() => {
              loadBrackets();
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
              loadTeams();
              setShowAddSeedingModal(true);
            }}
          >
            + Add Seeding
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              loadBrackets();
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

          <div className="status-filters">
            <button
              className={`status-filter-pill ${
                filterStatuses.length === QUEUE_STATUSES.length ? 'active' : ''
              }`}
              onClick={toggleAllStatuses}
            >
              All
            </button>
            {QUEUE_STATUSES.map((status) => (
              <button
                key={status}
                className={`status-filter-pill ${
                  filterStatuses.includes(status) ? 'active' : ''
                }`}
                onClick={() => toggleStatus(status)}
              >
                {QUEUE_STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <p>Loading queue...</p>
        ) : queue.length === 0 ? (
          <p style={{ color: 'var(--secondary-color)' }}>
            {filterStatuses.length === QUEUE_STATUSES.length &&
            filterType === 'all'
              ? 'Queue is empty. Use "Populate from Bracket" or add items manually.'
              : 'No queue items match the current filters.'}
          </p>
        ) : (
          <UnifiedTable
            columns={[
              {
                kind: 'data',
                id: 'gameNumber',
                sortId: 'gameNumber',
                sortable: true,
                header: { full: '#' },
                headerStyle: { width: '50px' },
                sortAriaLabel: 'Sort by queue order',
                renderCell: (item) => item.queue_position,
                cellClassName: 'queue-position',
              },
              {
                kind: 'data',
                id: 'teamNumber',
                sortId: 'teamNumber',
                sortable: true,
                header: { full: 'Team #' },
                headerStyle: { width: '120px' },
                sortAriaLabel: 'Sort by team number',
                renderCell: (item) => renderTeamNumberHelper(item),
              },
              {
                kind: 'data',
                id: 'teamName',
                sortId: 'teamName',
                sortable: true,
                header: { full: 'Team Name' },
                sortAriaLabel: 'Sort by team name',
                renderCell: (item) => renderItemDetails(item),
              },
              {
                kind: 'data',
                id: 'type',
                header: { full: 'Type' },
                headerStyle: { width: '80px' },
                renderCell: (item) => (
                  <span
                    className={`queue-type-badge ${getTypeClass(item.queue_type)}`}
                  >
                    {item.queue_type}
                  </span>
                ),
              },
              {
                kind: 'data',
                id: 'calledAt',
                header: { full: 'Called At' },
                headerStyle: { width: '120px' },
                cellClassName: 'queue-called-at',
                renderCell: (item) => formatCalledAt(item.called_at),
              },
              {
                kind: 'data',
                id: 'status',
                header: { full: 'Status' },
                headerStyle: { width: '100px' },
                renderCell: (item) => (
                  <span
                    className={`queue-status-badge ${getQueueStatusClass(item.status)}`}
                  >
                    {QUEUE_STATUS_LABELS[item.status]}
                  </span>
                ),
              },
              {
                kind: 'data',
                id: 'actions',
                header: { full: 'Actions' },
                headerStyle: { width: '200px' },
                renderCell: (item) => {
                  const nextStatus = getNextQueueStatus(item.status);
                  return (
                    <div className="queue-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={QUEUE_STATUSES.indexOf(item.status) <= 0}
                        onClick={() => handleFlowStep(item, 'prev')}
                        title="Previous step"
                      >
                        Back
                      </button>
                      <button
                        type="button"
                        className="btn btn-success"
                        disabled={nextStatus === null}
                        onClick={() => handleFlowStep(item, 'next')}
                        title={
                          nextStatus
                            ? `Advance to ${QUEUE_STATUS_LABELS[nextStatus]}`
                            : 'Next step'
                        }
                      >
                        {nextStatus
                          ? `${QUEUE_STATUS_LABELS[nextStatus]}`
                          : 'End'}
                      </button>
                    </div>
                  );
                },
              },
              {
                kind: 'data',
                id: 'order',
                header: { full: 'Order' },
                headerStyle: { width: '60px' },
                renderCell: (item) => {
                  const index = queue.findIndex((q) => q.id === item.id);
                  return (
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
                  );
                },
              },
            ]}
            rows={sortedQueue}
            getRowKey={(item) => item.id}
            activeSortId={sortField}
            sortDirection={sortDirection}
            onSort={(id) => handleSort(id as SortField)}
            headerLabelVariant="none"
            sortButtonClassName="queue-sort-button unified-table-sort-btn"
            rowClassName={(item) =>
              `queue-row ${getQueueRowStatusClass(item.status)}`
            }
            highlightActiveColumn={false}
          />
        )}
        <div className="queue-summary">
          {queue.length} item{queue.length !== 1 ? 's' : ''} in queue
          {(filterStatuses.length !== QUEUE_STATUSES.length ||
            filterType !== 'all') &&
            ' (filtered)'}
        </div>
      </div>

      <PopulateFromBracketModal
        open={showPopulateModal}
        brackets={brackets}
        onClose={() => setShowPopulateModal(false)}
        onSubmit={handlePopulateFromBracket}
      />
      <PopulateFromSeedingModal
        open={showPopulateSeedingModal}
        onClose={() => setShowPopulateSeedingModal(false)}
        onSubmit={handlePopulateFromSeeding}
      />
      <AddSeedingModal
        open={showAddSeedingModal}
        teams={teams}
        seedingRounds={seedingRounds}
        onClose={() => setShowAddSeedingModal(false)}
        onSubmit={handleAddSeeding}
      />
      <AddBracketGameModal
        open={showAddBracketModal}
        brackets={brackets}
        bracketGames={bracketGames}
        onClose={() => setShowAddBracketModal(false)}
        onLoadGames={loadGames}
        onClearGames={() => setBracketGames([])}
        onSubmit={handleAddBracketGame}
      />

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
