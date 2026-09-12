import React, { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext';
import {
  adminEventPath,
  adminBracketPath,
  isBracketDetailView,
  type BracketDetailView as BracketDetailViewType,
} from '../../utils/routes';
import { Bracket, BracketStatus, STATUS_LABELS } from '../../types/brackets';
import type { AssignedTeam } from '../../api/brackets';
import type { Team } from '../../api/teams';
import type { SeedingRanking } from '../../api/seeding';
import type { DoubleSeedingRanking } from '../../api/doubleSeeding';
import { ApiError } from '../../api/http';
import { teamsQueryOptions } from '../../queries/teams';
import { seedingRankingsQueryOptions } from '../../queries/seeding';
import { doubleSeedingRankingsQueryOptions } from '../../queries/doubleSeeding';
import {
  assignedTeamsQueryOptions,
  bracketQueryOptions,
  bracketRankingsQueryOptions,
  bracketsQueryOptions,
  useBracketMutations,
} from '../../queries/brackets';
import QueryFeedback, { queryData } from '../QueryFeedback';
import BracketListTable from '../bracket/BracketListTable';
import BracketDetailView from '../bracket/BracketDetailView';
import { UnifiedTable } from '../table';
import type { UnifiedColumnDef } from '../table';
import '../Modal.css';
import './BracketsTab.css';

interface BracketFormData {
  name: string;
  bracket_size: number;
  actual_team_count: string;
  weight: string;
}

interface BracketCreateMatrixRow {
  team: Team;
  ranking: SeedingRanking | undefined;
  doubleSeedingRanking: DoubleSeedingRanking | undefined;
  assigned: AssignedTeam | undefined;
  hasOverlap: boolean;
}

function nextPowerOfTwo(n: number): number {
  if (n <= 0) return 4;
  const p = Math.pow(2, Math.ceil(Math.log2(n)));
  return Math.max(4, Math.min(64, p));
}

const BRACKET_SIZES = [4, 8, 16, 32, 64];
const EMPTY_BRACKETS: Bracket[] = [];
const EMPTY_TEAMS: Team[] = [];
const EMPTY_RANKINGS: SeedingRanking[] = [];
const EMPTY_DS_RANKINGS: DoubleSeedingRanking[] = [];
const EMPTY_ASSIGNED: AssignedTeam[] = [];

const defaultFormData: BracketFormData = {
  name: '',
  bracket_size: 8,
  actual_team_count: '',
  weight: '1',
};

export default function BracketsTab() {
  const { selectedEvent } = useEvent();
  const { user, loading: authLoading } = useAuth();
  const selectedEventId = selectedEvent?.id ?? null;
  const doubleSeedingEnabled = (selectedEvent?.double_seeding_rounds ?? 0) > 0;
  const navigate = useNavigate();
  const { bracketId: bracketIdParam } = useParams<{ bracketId?: string }>();
  const [searchParams] = useSearchParams();
  const userId = user?.id ?? 0;
  const enabled = Boolean(user && !authLoading && selectedEventId);
  const { create, update, remove, generateEntries, generateGames } =
    useBracketMutations();

  const selectedBracketId = bracketIdParam ? Number(bracketIdParam) : null;

  const setSelectedBracketId = (id: number | null) => {
    if (id && selectedEventId) {
      const viewParam = searchParams.get('view');
      const view: BracketDetailViewType = isBracketDetailView(viewParam)
        ? viewParam
        : 'bracket';
      navigate(adminBracketPath(selectedEventId, id, view));
    } else if (selectedEventId) {
      navigate(adminEventPath(selectedEventId, 'brackets'));
    }
  };

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [formData, setFormData] = useState<BracketFormData>(defaultFormData);
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<number>>(
    new Set(),
  );

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  const bracketsQuery = useQuery({
    ...bracketsQueryOptions(userId, selectedEventId ?? 0),
    enabled,
  });
  const brackets = queryData(bracketsQuery) ?? EMPTY_BRACKETS;
  const loading = bracketsQuery.isLoading;

  const detailQuery = useQuery({
    ...bracketQueryOptions(
      userId,
      selectedEventId ?? 0,
      selectedBracketId ?? 0,
    ),
    enabled: enabled && selectedBracketId != null,
  });
  const rankingsQuery = useQuery({
    ...bracketRankingsQueryOptions(
      userId,
      selectedEventId ?? 0,
      selectedBracketId ?? 0,
    ),
    enabled: enabled && selectedBracketId != null,
  });
  const bracketDetail = queryData(detailQuery);
  const rankings = queryData(rankingsQuery)?.entries ?? null;
  const rankingsWeight = queryData(rankingsQuery)?.weight ?? 1;
  const detailLoading = detailQuery.isLoading;
  const rankingsLoading = rankingsQuery.isFetching;

  useEffect(() => {
    if (
      selectedEventId &&
      selectedBracketId != null &&
      detailQuery.isError &&
      detailQuery.error instanceof ApiError &&
      detailQuery.error.status === 404
    ) {
      navigate(adminEventPath(selectedEventId, 'brackets'), { replace: true });
    }
  }, [
    detailQuery.error,
    detailQuery.isError,
    navigate,
    selectedBracketId,
    selectedEventId,
  ]);

  const createEnabled = enabled && showCreateModal;
  const createTeamsQuery = useQuery({
    ...teamsQueryOptions(userId, selectedEventId ?? 0),
    enabled: createEnabled,
  });
  const createRankingsQuery = useQuery({
    ...seedingRankingsQueryOptions(userId, selectedEventId ?? 0),
    enabled: createEnabled,
  });
  const createDsRankingsQuery = useQuery({
    ...doubleSeedingRankingsQueryOptions(userId, selectedEventId ?? 0),
    enabled: createEnabled && doubleSeedingEnabled,
  });
  const createAssignedQuery = useQuery({
    ...assignedTeamsQueryOptions(userId, selectedEventId ?? 0),
    enabled: createEnabled,
  });
  const createTeams = queryData(createTeamsQuery) ?? EMPTY_TEAMS;
  const createRankings = queryData(createRankingsQuery) ?? EMPTY_RANKINGS;
  const createDoubleSeedingRankings = doubleSeedingEnabled
    ? (queryData(createDsRankingsQuery) ?? EMPTY_DS_RANKINGS)
    : EMPTY_DS_RANKINGS;
  const createAssigned = queryData(createAssignedQuery) ?? EMPTY_ASSIGNED;
  const createDataLoading =
    createTeamsQuery.isLoading ||
    createRankingsQuery.isLoading ||
    (doubleSeedingEnabled && createDsRankingsQuery.isLoading) ||
    createAssignedQuery.isLoading;

  useEffect(() => {
    if (showCreateModal) setSelectedTeamIds(new Set());
  }, [showCreateModal, selectedEventId]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId || !user) return;
    if (!formData.name.trim()) {
      toast.error('Bracket name is required');
      return;
    }
    const teamIds = Array.from(selectedTeamIds);
    if (teamIds.length === 0) {
      toast.error('Select at least one team for the bracket');
      return;
    }
    try {
      const data = await create.mutateAsync({
        userId: user.id,
        eventId: selectedEventId,
        event_id: selectedEventId,
        name: formData.name.trim(),
        team_ids: teamIds,
        weight: formData.weight ? parseFloat(formData.weight) : undefined,
      });
      toast.success('Bracket created!');
      setShowCreateModal(false);
      setFormData(defaultFormData);
      setSelectedTeamIds(new Set());
      if (data.id) setSelectedBracketId(data.id);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to create bracket',
      );
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bracketDetail || !user || !selectedEventId) return;
    if (!formData.name.trim()) {
      toast.error('Bracket name is required');
      return;
    }
    const body: {
      name: string;
      bracket_size: number;
      actual_team_count?: number | null;
      weight?: number;
    } = {
      name: formData.name.trim(),
      bracket_size: formData.bracket_size,
    };
    if (formData.actual_team_count) {
      const count = parseInt(formData.actual_team_count, 10);
      if (!isNaN(count) && count > 0) body.actual_team_count = count;
    } else {
      body.actual_team_count = null;
    }
    if (formData.weight) {
      const w = parseFloat(formData.weight);
      if (!isNaN(w) && w > 0 && w <= 1) body.weight = w;
    }
    try {
      await update.mutateAsync({
        userId: user.id,
        eventId: selectedEventId,
        bracketId: bracketDetail.id,
        data: body,
      });
      toast.success('Bracket updated!');
      setShowEditModal(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to update bracket',
      );
    }
  };

  const handleDelete = async (bracket: Bracket) => {
    if (!user || !selectedEventId) return;
    const confirmed = await confirm({
      title: 'Delete Bracket',
      message: `Are you sure you want to delete "${bracket.name}"? This will remove all entries and games. This cannot be undone.`,
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;
    try {
      await remove.mutateAsync({
        userId: user.id,
        eventId: selectedEventId,
        bracketId: bracket.id,
      });
      toast.success('Bracket deleted');
      if (selectedBracketId === bracket.id) {
        navigate(adminEventPath(selectedEventId, 'brackets'));
      }
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to delete bracket',
      );
    }
  };

  const handleGenerateEntries = async () => {
    if (!bracketDetail || !user || !selectedEventId) return;
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
    try {
      const data = await generateEntries.mutateAsync({
        userId: user.id,
        eventId: selectedEventId,
        bracketId: bracketDetail.id,
        force: hasEntries,
      });
      toast.success(
        `Generated ${data.entriesCreated} entries (${data.byeCount} byes)`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to generate entries',
      );
    }
  };

  const handleGenerateGames = async () => {
    if (!bracketDetail || !user || !selectedEventId) return;
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
    try {
      const data = await generateGames.mutateAsync({
        userId: user.id,
        eventId: selectedEventId,
        bracketId: bracketDetail.id,
        force: hasGames,
      });
      toast.success(`Generated ${data.gamesCreated} games`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'Failed to generate games',
      );
    }
  };

  const handleStatusChange = async (newStatus: BracketStatus) => {
    if (!bracketDetail || !user || !selectedEventId) return;
    try {
      await update.mutateAsync({
        userId: user.id,
        eventId: selectedEventId,
        bracketId: bracketDetail.id,
        data: { status: newStatus },
      });
      toast.success(`Bracket status updated to ${STATUS_LABELS[newStatus]}`);
    } catch (error) {
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
      weight: bracketDetail.weight?.toString() || '1',
    });
    setShowEditModal(true);
  };

  const saving = create.isPending || update.isPending;

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
        disabled={generateEntries.isPending}
      >
        {generateEntries.isPending ? 'Generating...' : 'Generate from Seeding'}
      </button>
    );
  };

  const renderGamesActions = () => {
    if (!bracketDetail) return null;
    return (
      <button
        className={`btn ${bracketDetail.games.length > 0 ? 'btn-danger' : 'btn-primary'}`}
        onClick={handleGenerateGames}
        disabled={generateGames.isPending || bracketDetail.entries.length === 0}
        title={
          bracketDetail.entries.length === 0 ? 'Generate entries first' : ''
        }
      >
        {generateGames.isPending
          ? 'Generating...'
          : bracketDetail.games.length > 0
            ? 'Clear ALL Games and Regenerate'
            : 'Generate Games'}
      </button>
    );
  };

  const bracketCreateMatrixRows = useMemo((): BracketCreateMatrixRow[] => {
    return [...createTeams]
      .map((team) => {
        const ranking = createRankings.find((r) => r.team_id === team.id);
        const doubleSeedingRanking = createDoubleSeedingRankings.find(
          (r) => r.team_id === team.id,
        );
        const assigned = createAssigned.find((a) => a.team_id === team.id);
        const isSelected = selectedTeamIds.has(team.id);
        const hasOverlap = isSelected && !!assigned;
        return {
          team,
          ranking,
          doubleSeedingRanking,
          assigned,
          hasOverlap,
        };
      })
      .sort((a, b) => {
        if (doubleSeedingEnabled) {
          const combinedA =
            a.ranking?.seed_average != null &&
            a.doubleSeedingRanking?.seed_average != null
              ? a.ranking.seed_average + a.doubleSeedingRanking.seed_average
              : null;
          const combinedB =
            b.ranking?.seed_average != null &&
            b.doubleSeedingRanking?.seed_average != null
              ? b.ranking.seed_average + b.doubleSeedingRanking.seed_average
              : null;
          if (combinedA != null && combinedB != null && combinedA !== combinedB)
            return combinedB - combinedA;
          if (combinedA == null && combinedB != null) return 1;
          if (combinedA != null && combinedB == null) return -1;
        }
        const rankA = a.ranking?.seed_rank;
        const rankB = b.ranking?.seed_rank;
        if (rankA == null && rankB == null)
          return a.team.team_number - b.team.team_number;
        if (rankA == null) return 1;
        if (rankB == null) return -1;
        return rankA - rankB;
      });
  }, [
    createTeams,
    createRankings,
    createDoubleSeedingRankings,
    createAssigned,
    selectedTeamIds,
    doubleSeedingEnabled,
  ]);

  const bracketCreateMatrixColumns =
    useMemo((): UnifiedColumnDef<BracketCreateMatrixRow>[] => {
      const cols: UnifiedColumnDef<BracketCreateMatrixRow>[] = [
        {
          kind: 'data',
          id: 'select',
          header: { full: 'Select' },
          headerStyle: { width: 40 },
          renderCell: (r) => (
            <input
              type="checkbox"
              checked={selectedTeamIds.has(r.team.id)}
              onChange={(e) => {
                setSelectedTeamIds((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) {
                    next.add(r.team.id);
                  } else {
                    next.delete(r.team.id);
                  }
                  return next;
                });
              }}
              disabled={!!r.assigned}
              title={
                r.assigned
                  ? `${r.team.team_name} is already in ${r.assigned.bracket_name}`
                  : undefined
              }
            />
          ),
        },
        {
          kind: 'data',
          id: 'team_number',
          header: { full: 'Team #' },
          renderCell: (r) => r.team.team_number,
        },
        {
          kind: 'data',
          id: 'team_name',
          header: { full: 'Team Name' },
          renderCell: (r) => r.team.team_name,
        },
      ];
      cols.push(
        {
          kind: 'data',
          id: 'seed_avg',
          header: { full: 'Seed Avg' },
          renderCell: (r) =>
            r.ranking?.seed_average != null
              ? r.ranking.seed_average.toFixed(2)
              : '—',
        },
        {
          kind: 'data',
          id: 'rank',
          header: { full: 'Rank' },
          renderCell: (r) => r.ranking?.seed_rank ?? '—',
        },
      );
      if (doubleSeedingEnabled) {
        cols.push(
          {
            kind: 'data',
            id: 'ds_avg',
            header: { full: 'DS Avg' },
            renderCell: (r) =>
              r.doubleSeedingRanking?.seed_average?.toFixed(2) ?? '—',
          },
          {
            kind: 'data',
            id: 'ds_rank',
            header: { full: 'DS Rank' },
            renderCell: (r) => r.doubleSeedingRanking?.seed_rank ?? '—',
          },
          {
            kind: 'data',
            id: 'combined_avg',
            header: { full: 'Combined Avg' },
            renderCell: (r) =>
              r.ranking?.seed_average != null &&
              r.doubleSeedingRanking?.seed_average != null
                ? (
                    (r.ranking.seed_average +
                      r.doubleSeedingRanking.seed_average) /
                    2
                  ).toFixed(2)
                : '—',
          },
        );
      }
      cols.push({
        kind: 'data',
        id: 'assigned',
        header: { full: 'Assigned' },
        renderCell: (r) =>
          r.assigned ? (
            <span
              className="bracket-create-assigned"
              title={`In ${r.assigned.bracket_name}`}
            >
              {r.assigned.bracket_name}
            </span>
          ) : (
            '—'
          ),
      });
      return cols;
    }, [doubleSeedingEnabled, selectedTeamIds]);

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
            {bracketsQuery.isError ? (
              <QueryFeedback query={bracketsQuery} />
            ) : loading ? (
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
          {detailQuery.isError &&
          !(
            detailQuery.error instanceof ApiError &&
            detailQuery.error.status === 404
          ) ? (
            <QueryFeedback query={detailQuery} />
          ) : detailLoading ? (
            <p>Loading bracket details...</p>
          ) : bracketDetail ? (
            <BracketDetailView
              bracketDetail={bracketDetail}
              onBack={() => {
                if (selectedEventId) {
                  navigate(adminEventPath(selectedEventId, 'brackets'));
                }
              }}
              adminActions={renderAdminActions()}
              entriesActions={renderEntriesActions()}
              gamesActions={renderGamesActions()}
              rankings={rankings}
              rankingsWeight={rankingsWeight}
              rankingsLoading={rankingsLoading}
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

              <div className="form-group">
                <label htmlFor="bracket-weight">Weight</label>
                <input
                  id="bracket-weight"
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
                      <UnifiedTable
                        columns={bracketCreateMatrixColumns}
                        rows={bracketCreateMatrixRows}
                        getRowKey={(r) => r.team.id}
                        rowClassName={(r) =>
                          r.hasOverlap ? 'bracket-create-overlap' : ''
                        }
                        tableClassName="bracket-create-teams-table"
                        headerLabelVariant="none"
                      />
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
