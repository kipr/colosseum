import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UnifiedTable } from '../table';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext';
import { formatCalledAt } from '../../utils/dateUtils';
import {
  describeRestDuration,
  formatRestDuration,
  getQueueRestWarnings,
  type TeamRestWarning,
} from '../../utils/queueRest';
import {
  QUEUE_STATUSES,
  type QueueItem,
  type QueueStatus,
  type QueueType,
} from '../../api/queue';
import { adminQueueQueryOptions, useQueueMutations } from '../../queries/queue';
import {
  bracketsQueryOptions,
  bracketQueryOptions,
} from '../../queries/brackets';
import { teamsQueryOptions } from '../../queries/teams';
import QueryFeedback, { queryData } from '../QueryFeedback';
import '../Modal.css';
import './QueueTab.css';

interface QueueParticipant {
  id: number;
  teamNumber: number | null;
}

const STATUS_ORDER = QUEUE_STATUSES;

type SortField = 'gameNumber' | 'teamNumber' | 'teamName';
type SortDirection = 'asc' | 'desc';

const TYPE_OPTIONS: { value: QueueType | 'all'; label: string }[] = [
  { value: 'all', label: 'All Types' },
  { value: 'seeding', label: 'Seeding' },
  { value: 'bracket', label: 'Bracket' },
  { value: 'double_seeding', label: 'Double Seeding' },
];

const REST_CLOCK_INTERVAL_MS = 30_000;

const TYPE_BADGE_LABELS: Record<QueueType, string> = {
  seeding: 'seeding',
  bracket: 'bracket',
  double_seeding: '2x seeding',
};

function getTypeClass(type: QueueType): string {
  return `queue-type-${type.replace(/_/g, '-')}`;
}

function getStatusClass(status: QueueStatus): string {
  return `queue-status-${status.replace(/_/g, '-')}`;
}

/** Row background tint (queued = default table background). */
function getRowStatusClass(status: QueueStatus): string {
  return `queue-row--${status.replace(/_/g, '-')}`;
}

const STATUS_LABELS: Record<QueueStatus, string> = {
  queued: 'Queued',
  called: 'Called',
  arrived: 'Arrived',
  on_table: 'On table',
  scored: 'Scored',
};

/** Next status in the queue flow, or null if already at the terminal state. */
function getNextQueueStatus(current: QueueStatus): QueueStatus | null {
  const idx = STATUS_ORDER.indexOf(current);
  if (idx < 0 || idx >= STATUS_ORDER.length - 1) return null;
  return STATUS_ORDER[idx + 1]!;
}

/** Return the two current participants for queue rows with paired arrival. */
function getQueueParticipants(
  item: QueueItem,
): [QueueParticipant, QueueParticipant] | null {
  if (
    item.queue_type === 'bracket' &&
    item.team1_id != null &&
    item.team2_id != null
  ) {
    return [
      { id: item.team1_id, teamNumber: item.team1_number },
      { id: item.team2_id, teamNumber: item.team2_number },
    ];
  }

  if (
    item.queue_type === 'double_seeding' &&
    item.double_seeding_team1_id != null &&
    item.double_seeding_team2_id != null
  ) {
    return [
      {
        id: item.double_seeding_team1_id,
        teamNumber: item.double_seeding_team1_number,
      },
      {
        id: item.double_seeding_team2_id,
        teamNumber: item.double_seeding_team2_number,
      },
    ];
  }

  return null;
}

function participantLabel(participant: QueueParticipant): string {
  return `#${participant.teamNumber ?? participant.id}`;
}

export default function QueueTab() {
  const { selectedEvent } = useEvent();
  const { user, loading: authLoading } = useAuth();
  const selectedEventId = selectedEvent?.id ?? null;
  const userId = user?.id ?? 0;
  const enabled = Boolean(user && !authLoading && selectedEventId);
  const seedingRounds = selectedEvent?.seeding_rounds ?? 3;
  const minRestMinutes = selectedEvent?.min_rest_minutes ?? 10;
  const [filterStatuses, setFilterStatuses] = useState<QueueStatus[]>([
    ...QUEUE_STATUSES,
  ]);
  const [filterType, setFilterType] = useState<QueueType | 'all'>('all');
  const [sortField, setSortField] = useState<SortField>('gameNumber');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [showPopulateModal, setShowPopulateModal] = useState(false);
  const [showPopulateSeedingModal, setShowPopulateSeedingModal] =
    useState(false);
  const [showAddSeedingModal, setShowAddSeedingModal] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [selectedRound, setSelectedRound] = useState<number>(1);
  const [showAddBracketModal, setShowAddBracketModal] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState<number | null>(null);
  const [addBracketSelectedBracketId, setAddBracketSelectedBracketId] =
    useState<number | null>(null);

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();
  const fail = (fallback: string, error: unknown) =>
    toast.error(error instanceof Error ? error.message : fallback);
  const queueQuery = useQuery({
    ...adminQueueQueryOptions(userId, selectedEventId ?? 0, {
      statuses: filterStatuses,
      queueType: filterType,
    }),
    enabled,
  });
  const queue = queryData(queueQuery) ?? [];
  const loading = queueQuery.isLoading && queryData(queueQuery) === undefined;
  const dialogEventId = selectedEventId ?? 0;
  const bracketsQuery = useQuery({
    ...bracketsQueryOptions(userId, dialogEventId),
    enabled: enabled && (showPopulateModal || showAddBracketModal),
  });
  const teamsQuery = useQuery({
    ...teamsQueryOptions(userId, dialogEventId),
    enabled: enabled && showAddSeedingModal,
  });
  const bracketDetailQuery = useQuery({
    ...bracketQueryOptions(
      userId,
      dialogEventId,
      addBracketSelectedBracketId ?? 0,
    ),
    enabled:
      enabled && showAddBracketModal && addBracketSelectedBracketId != null,
  });
  const brackets = queryData(bracketsQuery) ?? [];
  const teams = queryData(teamsQuery) ?? [];
  const bracketGames = (queryData(bracketDetailQuery)?.games ?? []).filter(
    (game) => game.team1_id && game.team2_id && game.status !== 'completed',
  );
  const effectiveTeamId = selectedTeamId ?? teams[0]?.id ?? null;
  const effectiveGameId = selectedGameId ?? bracketGames[0]?.id ?? null;
  const {
    populateFromBracket,
    populateFromSeeding,
    add,
    updateStatus,
    call,
    updatePresence,
  } = useQueueMutations();
  const populating = populateFromBracket.isPending;
  const populatingSeeding = populateFromSeeding.isPending;
  const addingSeeding =
    add.isPending && add.variables?.queue_type === 'seeding';
  const addingBracket =
    add.isPending && add.variables?.queue_type === 'bracket';
  const scope = () => ({ userId, eventId: selectedEventId ?? 0 });

  useEffect(() => {
    const interval = window.setInterval(
      () => setNowMs(Date.now()),
      REST_CLOCK_INTERVAL_MS,
    );
    return () => window.clearInterval(interval);
  }, []);

  const handlePopulateFromBracket = async () => {
    if (!selectedEventId || brackets.length === 0) return;

    const confirmed = await confirm({
      title: 'Populate Queue from Brackets',
      message:
        'This will replace every bracket item and reset its call and table state. Seeding and double-seeding items will remain. Continue?',
      confirmText: 'Populate',
      confirmStyle: 'danger',
    });

    if (!confirmed) return;

    try {
      const data = await populateFromBracket.mutateAsync(scope());
      toast.success(`Added ${data.created} games to the queue`);
      setShowPopulateModal(false);
    } catch (error) {
      fail('Failed to populate queue', error);
    }
  };

  // Handle populate from seeding
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
      const data = await populateFromSeeding.mutateAsync(scope());
      toast.success(`Added ${data.created} seeding rounds to the queue`);
      setShowPopulateSeedingModal(false);
    } catch (error) {
      fail('Failed to populate queue', error);
    }
  };

  // Handle add seeding round
  const handleAddSeeding = async () => {
    if (!selectedEventId || !effectiveTeamId) return;

    const confirmed = await confirm({
      title: 'Add Seeding Round',
      message:
        'Games are automatically queued, are you sure you need to add this? Have you double checked the list?',
      confirmText: 'Add',
      confirmStyle: 'danger',
    });

    if (!confirmed) return;

    try {
      await add.mutateAsync({
        ...scope(),
        event_id: selectedEventId,
        queue_type: 'seeding',
        seeding_team_id: effectiveTeamId,
        seeding_round: selectedRound,
      });
      toast.success('Seeding round added to queue');
      setShowAddSeedingModal(false);
    } catch (error) {
      fail('Failed to add seeding round', error);
    }
  };

  // Handle add bracket game
  const handleAddBracketGame = async () => {
    if (!selectedEventId || !effectiveGameId) return;

    const confirmed = await confirm({
      title: 'Add Bracket Game',
      message:
        'Games are automatically queued, are you sure you need to add this? Have you double checked the list?',
      confirmText: 'Add',
      confirmStyle: 'danger',
    });

    if (!confirmed) return;

    try {
      await add.mutateAsync({
        ...scope(),
        event_id: selectedEventId,
        queue_type: 'bracket',
        bracket_game_id: effectiveGameId,
      });
      toast.success('Bracket game added to queue');
      setShowAddBracketModal(false);
    } catch (error) {
      fail('Failed to add bracket game', error);
    }
  };

  const getVisibleRestWarnings = (item: QueueItem, atMs = nowMs) =>
    item.status === 'queued'
      ? getQueueRestWarnings(item, minRestMinutes, atMs)
      : [];

  const warningTeamLabel = (warning: TeamRestWarning) =>
    warning.teamNumber == null ? 'Team' : `Team #${warning.teamNumber}`;

  const warningDescription = (warning: TeamRestWarning) => {
    if (warning.kind === 'busy') {
      return `${warningTeamLabel(warning)} is currently active in another queue item.`;
    }

    const elapsed = describeRestDuration(warning.elapsedMinutes ?? 0);
    const completedAt = warning.lastPlayedAt
      ? ` (completed ${formatCalledAt(warning.lastPlayedAt)})`
      : '';
    return `${warningTeamLabel(warning)} finished another match ${elapsed}${completedAt}.`;
  };

  /** Move one step forward or backward in queue flow (queued → called → … → scored). */
  const handleFlowStep = async (
    item: QueueItem,
    direction: 'next' | 'prev',
  ) => {
    const idx = STATUS_ORDER.indexOf(item.status);
    if (idx < 0) return;
    const delta = direction === 'next' ? 1 : -1;
    const nextIdx = idx + delta;
    if (nextIdx < 0 || nextIdx >= STATUS_ORDER.length) return;
    const targetStatus = STATUS_ORDER[nextIdx]!;

    if (
      direction === 'next' &&
      item.status === 'queued' &&
      targetStatus === 'called'
    ) {
      const warnings = getVisibleRestWarnings(item, Date.now());
      if (warnings.length > 0) {
        const confirmed = await confirm({
          title: 'Call Team Anyway?',
          message: `${warnings.map(warningDescription).join(' ')} Call anyway?`,
          confirmText: 'Call Anyway',
          confirmStyle: 'warning',
        });
        if (!confirmed) return;
      }
    }

    try {
      if (
        direction === 'next' &&
        item.status === 'queued' &&
        targetStatus === 'called'
      ) {
        await call.mutateAsync({ ...scope(), queueItemId: item.id });
      } else {
        await updateStatus.mutateAsync({
          ...scope(),
          queueItemId: item.id,
          status: targetStatus,
        });
      }
    } catch (error) {
      fail('Failed to update status', error);
    }
  };

  const handlePresence = async (
    item: QueueItem,
    participant: QueueParticipant,
    present: boolean,
  ) => {
    try {
      await updatePresence.mutateAsync({
        ...scope(),
        queueItemId: item.id,
        teamId: participant.id,
        present,
      });
    } catch (error) {
      fail('Failed to update team presence', error);
    }
  };

  // Render item details
  const renderTeamWithWarning = (
    teamId: number | null,
    teamNumber: number | null,
    warnings: TeamRestWarning[],
  ) => {
    const warning =
      teamId == null
        ? undefined
        : warnings.find((candidate) => candidate.teamId === teamId);
    const plainLabel = teamNumber ?? '-';

    if (!warning) return <span>{plainLabel}</span>;

    const chipLabel =
      warning.kind === 'busy'
        ? `#${teamNumber ?? '?'} · busy`
        : `#${teamNumber ?? '?'} · ${formatRestDuration(warning.elapsedMinutes ?? 0)}`;
    const description = warningDescription(warning);

    return (
      <span
        className={`queue-rest-chip queue-rest-chip--${warning.kind}`}
        title={description}
        aria-label={description}
      >
        {chipLabel}
      </span>
    );
  };

  const renderTeamNumber = (item: QueueItem) => {
    const warnings = getVisibleRestWarnings(item);

    if (item.queue_type === 'seeding') {
      return renderTeamWithWarning(
        item.seeding_team_id,
        item.seeding_team_number,
        warnings,
      );
    }

    if (item.queue_type === 'double_seeding') {
      if (item.double_seeding_team2_id == null) {
        return (
          <span className="queue-team-numbers">
            {renderTeamWithWarning(
              item.double_seeding_team1_id,
              item.double_seeding_team1_number,
              warnings,
            )}{' '}
            <span>(solo)</span>
          </span>
        );
      }
      return (
        <span className="queue-team-numbers">
          {renderTeamWithWarning(
            item.double_seeding_team1_id,
            item.double_seeding_team1_number,
            warnings,
          )}
          <span>vs</span>
          {renderTeamWithWarning(
            item.double_seeding_team2_id,
            item.double_seeding_team2_number,
            warnings,
          )}
        </span>
      );
    }

    return (
      <span className="queue-team-numbers">
        {renderTeamWithWarning(item.team1_id, item.team1_number, warnings)}
        <span>vs</span>
        {renderTeamWithWarning(item.team2_id, item.team2_number, warnings)}
      </span>
    );
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

    if (item.queue_type === 'double_seeding') {
      const team1Name = item.double_seeding_team1_name || '';
      const team2Name =
        item.double_seeding_team2_id == null
          ? 'Solo run'
          : item.double_seeding_team2_name || '';
      return (
        <div className="queue-game-details">
          <span className="queue-game-title">
            {team1Name} vs {team2Name}
          </span>
          <span className="queue-game-teams">
            Round {item.double_seeding_round} · Match{' '}
            {item.double_seeding_match_number}
          </span>
        </div>
      );
    }

    // Bracket game
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

  // Handle status toggle
  const toggleStatus = (status: QueueStatus) => {
    setFilterStatuses((prev) => {
      let next;
      if (prev.includes(status)) {
        next = prev.filter((s) => s !== status);
      } else {
        next = [...prev, status];
      }

      // Guardrail: fallback to all if empty
      if (next.length === 0) {
        return Object.keys(STATUS_LABELS) as QueueStatus[];
      }
      return next;
    });
  };

  const toggleAllStatuses = () => {
    const allStatuses = Object.keys(STATUS_LABELS) as QueueStatus[];
    if (filterStatuses.length === allStatuses.length) {
      // If all are selected, revert to default set
      setFilterStatuses(['queued', 'called', 'arrived', 'on_table']);
    } else {
      setFilterStatuses(allStatuses);
    }
  };

  const getTeamSortValue = (item: QueueItem): string => {
    if (item.queue_type === 'seeding') {
      return (item.seeding_team_name || '').toLowerCase();
    }
    if (item.queue_type === 'double_seeding') {
      const team1 = (item.double_seeding_team1_name || '').toLowerCase();
      const team2 = (item.double_seeding_team2_name || '').toLowerCase();
      return `${team1} ${team2}`.trim();
    }
    const team1 = (item.team1_name || '').toLowerCase();
    const team2 = (item.team2_name || '').toLowerCase();
    return `${team1} ${team2}`.trim();
  };

  const getTeamNumberSortValue = (item: QueueItem): number => {
    if (item.queue_type === 'seeding') {
      return item.seeding_team_number ?? Number.MAX_SAFE_INTEGER;
    }
    if (item.queue_type === 'double_seeding') {
      return Math.min(
        item.double_seeding_team1_number ?? Number.MAX_SAFE_INTEGER,
        item.double_seeding_team2_number ?? Number.MAX_SAFE_INTEGER,
      );
    }
    return Math.min(
      item.team1_number ?? Number.MAX_SAFE_INTEGER,
      item.team2_number ?? Number.MAX_SAFE_INTEGER,
    );
  };

  const sortedQueue = useMemo(() => {
    const sorted = [...queue];
    sorted.sort((a, b) => {
      let valueCompare = 0;
      if (sortField === 'gameNumber') {
        const aValue = a.queue_position;
        const bValue = b.queue_position;
        valueCompare = aValue - bValue;
      } else if (sortField === 'teamNumber') {
        valueCompare = getTeamNumberSortValue(a) - getTeamNumberSortValue(b);
      } else {
        valueCompare = getTeamSortValue(a).localeCompare(getTeamSortValue(b));
      }

      if (valueCompare !== 0) {
        return sortDirection === 'asc' ? valueCompare : -valueCompare;
      }

      return a.queue_position - b.queue_position;
    });
    return sorted;
  }, [queue, sortDirection, sortField]);

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortField(field);
    setSortDirection('asc');
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
            onClick={() => setShowPopulateModal(true)}
          >
            Populate from Brackets
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
              setSelectedTeamId(null);
              setShowAddSeedingModal(true);
            }}
          >
            + Add Seeding
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setAddBracketSelectedBracketId(null);
              setSelectedGameId(null);
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
                filterStatuses.length === Object.keys(STATUS_LABELS).length
                  ? 'active'
                  : ''
              }`}
              onClick={toggleAllStatuses}
            >
              All
            </button>
            {(Object.keys(STATUS_LABELS) as QueueStatus[]).map((status) => (
              <button
                key={status}
                className={`status-filter-pill ${
                  filterStatuses.includes(status) ? 'active' : ''
                }`}
                onClick={() => toggleStatus(status)}
              >
                {STATUS_LABELS[status]}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Queue table */}
      <div className="card">
        {queueQuery.isError ? <QueryFeedback query={queueQuery} /> : null}
        {loading ? (
          <p>Loading queue...</p>
        ) : queue.length === 0 ? (
          <p style={{ color: 'var(--secondary-color)' }}>
            {filterStatuses.length === Object.keys(STATUS_LABELS).length &&
            filterType === 'all'
              ? 'Queue is empty. Use "Populate from Brackets" or add items manually.'
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
                renderCell: (item) => renderTeamNumber(item),
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
                    {TYPE_BADGE_LABELS[item.queue_type]}
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
                headerStyle: { width: '140px' },
                renderCell: (item) => {
                  const participants = getQueueParticipants(item);
                  const showPresence =
                    item.status === 'called' && participants !== null;
                  const presentCount =
                    Number(item.team1_present) + Number(item.team2_present);
                  const waitingFor = participants
                    ?.filter(
                      (_, index) =>
                        !(index === 0
                          ? item.team1_present
                          : item.team2_present),
                    )
                    .map(participantLabel)
                    .join(' and ');

                  return (
                    <div className="queue-status-content">
                      <span
                        className={`queue-status-badge ${getStatusClass(item.status)}`}
                      >
                        {STATUS_LABELS[item.status]}
                      </span>
                      {showPresence && (
                        <div
                          className="queue-presence-progress"
                          aria-live="polite"
                        >
                          <span>{presentCount}/2 present</span>
                          <span className="queue-presence-waiting">
                            Waiting for {waitingFor}
                          </span>
                        </div>
                      )}
                    </div>
                  );
                },
              },
              {
                kind: 'data',
                id: 'actions',
                header: { full: 'Actions' },
                headerStyle: { width: '280px' },
                renderCell: (item) => {
                  const nextStatus = getNextQueueStatus(item.status);
                  const participants = getQueueParticipants(item);
                  const showPresence =
                    item.status === 'called' && participants !== null;
                  const presenceUpdating =
                    updatePresence.isPending &&
                    updatePresence.variables?.queueItemId === item.id;
                  const statusUpdating =
                    (call.isPending &&
                      call.variables?.queueItemId === item.id) ||
                    (updateStatus.isPending &&
                      updateStatus.variables?.queueItemId === item.id);
                  return (
                    <div className="queue-actions">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={
                          STATUS_ORDER.indexOf(item.status) <= 0 ||
                          presenceUpdating ||
                          statusUpdating
                        }
                        onClick={() => handleFlowStep(item, 'prev')}
                        title="Previous step"
                      >
                        Back
                      </button>
                      {showPresence ? (
                        <div className="queue-presence-controls">
                          {participants.map((participant, index) => {
                            const isPresent =
                              index === 0
                                ? item.team1_present
                                : item.team2_present;
                            const label = participantLabel(participant);
                            return (
                              <button
                                key={participant.id}
                                type="button"
                                className={`btn queue-presence-control${
                                  isPresent
                                    ? ' queue-presence-control--confirmed'
                                    : ''
                                }`}
                                disabled={presenceUpdating}
                                aria-pressed={isPresent}
                                title={
                                  isPresent
                                    ? `Undo ${label} presence confirmation`
                                    : `Mark ${label} present`
                                }
                                onClick={() =>
                                  handlePresence(item, participant, !isPresent)
                                }
                              >
                                {isPresent
                                  ? `✓ ${label} present`
                                  : `Mark ${label} present`}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-success"
                          disabled={nextStatus === null || statusUpdating}
                          onClick={() => handleFlowStep(item, 'next')}
                          title={
                            nextStatus
                              ? `Advance to ${STATUS_LABELS[nextStatus]}`
                              : 'Next step'
                          }
                        >
                          {nextStatus ? `${STATUS_LABELS[nextStatus]}` : 'End'}
                        </button>
                      )}
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
            rowClassName={(item) => {
              const hasRestWarning = getVisibleRestWarnings(item).length > 0;
              return `queue-row ${getRowStatusClass(item.status)}${
                hasRestWarning ? ' queue-row--rest-warning' : ''
              }`;
            }}
            highlightActiveColumn={false}
          />
        )}
        <div className="queue-summary">
          {queue.length} item{queue.length !== 1 ? 's' : ''} in queue
          {(filterStatuses.length !== Object.keys(STATUS_LABELS).length ||
            filterType !== 'all') &&
            ' (filtered)'}
        </div>
      </div>

      {/* Populate from Brackets Modal */}
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
            <h3>Populate Queue from Brackets</h3>
            <p
              style={{
                color: 'var(--secondary-color)',
                marginBottom: '1.5rem',
              }}
            >
              Replace bracket items with eligible games from all brackets in
              this event, using canonical interleaved order. Games must have
              both teams assigned. Seeding and double-seeding items remain in
              the queue.
            </p>

            {brackets.length === 0 ? (
              <p style={{ color: 'var(--secondary-color)' }}>
                No brackets found for this event.
              </p>
            ) : (
              <>
                <p style={{ color: 'var(--secondary-color)' }}>
                  {brackets.length} bracket{brackets.length === 1 ? '' : 's'}
                  will be populated.
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
                    onClick={() => setShowPopulateModal(false)}
                    disabled={populating}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={handlePopulateFromBracket}
                    disabled={populating}
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
              This will completely clear the existing queue and replace it with
              all unplayed seeding rounds (team + round combinations that
              don&apos;t have a score yet).
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
                className="btn btn-danger"
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
              Add a specific team&apos;s seeding round to the queue. Games are
              automatically queued—are you sure you need to add this? Have you
              double checked the list?
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
                    value={effectiveTeamId ?? ''}
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
                    className="btn btn-danger"
                    onClick={handleAddSeeding}
                    disabled={addingSeeding || !effectiveTeamId}
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
              Add a specific bracket game to the queue. Games are automatically
              queued—are you sure you need to add this? Have you double checked
              the list?
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
                      setAddBracketSelectedBracketId(bracketId || null);
                      setSelectedGameId(null);
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
                        value={effectiveGameId ?? ''}
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
                    className="btn btn-danger"
                    onClick={handleAddBracketGame}
                    disabled={addingBracket || !effectiveGameId}
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
