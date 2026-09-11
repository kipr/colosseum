import { useCallback, useState } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useConfirm } from '../../ConfirmModal';
import { useToast } from '../../Toast';
import { useEvent } from '../../../contexts/EventContext';
import {
  adminEventPath,
  adminBracketPath,
  isBracketDetailView,
  type BracketDetailView as BracketDetailViewType,
} from '../../../utils/routes';
import { Bracket, BracketStatus, STATUS_LABELS } from '../../../types/brackets';
import { isTeamAssignmentConflictError } from '../../../api/brackets';
import {
  useEventBrackets,
  useBracketDetail,
  useBracketMutations,
  useBracketCreateModal,
} from '../../../hooks/brackets';
import BracketListTable from '../../bracket/BracketListTable';
import BracketDetailView from '../../bracket/BracketDetailView';
import BracketCreateModal, { type BracketFormData } from './BracketCreateModal';
import BracketEditModal from './BracketEditModal';
import {
  renderAdminActions,
  renderEntriesActions,
  renderGamesActions,
} from './BracketAdminToolbar';
import './BracketsTab.css';

const defaultFormData: BracketFormData = {
  name: '',
  bracket_size: 8,
  actual_team_count: '',
  weight: '1',
};

export default function BracketsTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;
  const doubleSeedingEnabled = (selectedEvent?.double_seeding_rounds ?? 0) > 0;
  const navigate = useNavigate();
  const { bracketId: bracketIdParam } = useParams<{ bracketId?: string }>();
  const [searchParams] = useSearchParams();

  const selectedBracketId = bracketIdParam ? Number(bracketIdParam) : null;

  const setSelectedBracketId = useCallback(
    (id: number | null) => {
      if (id && selectedEventId) {
        const viewParam = searchParams.get('view');
        const view: BracketDetailViewType = isBracketDetailView(viewParam)
          ? viewParam
          : 'bracket';
        navigate(adminBracketPath(selectedEventId, id, view));
      } else if (selectedEventId) {
        navigate(adminEventPath(selectedEventId, 'brackets'));
      }
    },
    [selectedEventId, navigate, searchParams],
  );

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [formData, setFormData] = useState<BracketFormData>(defaultFormData);

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  const {
    brackets,
    loading,
    refresh: fetchBrackets,
  } = useEventBrackets(selectedEventId, {
    onError: (message) => toast.error(message),
  });

  const {
    bracketDetail,
    setBracketDetail,
    detailLoading,
    rankings,
    rankingsWeight,
    rankingsLoading,
    refresh: fetchBracketDetail,
    refreshRankings,
  } = useBracketDetail(selectedBracketId, {
    includeRankings: true,
    onNotFound: () => {
      if (selectedEventId) {
        navigate(adminEventPath(selectedEventId, 'brackets'), {
          replace: true,
        });
      }
    },
    onError: (message) => toast.error(message),
  });

  const mutations = useBracketMutations();
  const createModal = useBracketCreateModal(selectedEventId, {
    open: showCreateModal,
    doubleSeedingEnabled,
    onError: (message) => toast.error(message),
  });

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEventId) return;

    if (!formData.name.trim()) {
      toast.error('Bracket name is required');
      return;
    }

    const teamIds = Array.from(createModal.selectedTeamIds);
    if (teamIds.length === 0) {
      toast.error('Select at least one team for the bracket');
      return;
    }

    try {
      const data = await mutations.create({
        event_id: selectedEventId,
        name: formData.name.trim(),
        team_ids: teamIds,
        weight: formData.weight ? parseFloat(formData.weight) : undefined,
      });

      toast.success('Bracket created!');
      setShowCreateModal(false);
      setFormData(defaultFormData);
      createModal.setSelectedTeamIds(new Set());
      await fetchBrackets();
      if (data.id) {
        setSelectedBracketId(data.id);
      }
    } catch (error) {
      console.error('Error creating bracket:', error);
      if (isTeamAssignmentConflictError(error)) {
        const names = error.body.conflicts
          .map((c) => `${c.team_name} (in ${c.bracket_name})`)
          .join(', ');
        toast.error(
          `Teams already in another bracket: ${names}. Remove them from selection.`,
        );
        return;
      }
      toast.error(
        error instanceof Error ? error.message : 'Failed to create bracket',
      );
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bracketDetail) return;

    if (!formData.name.trim()) {
      toast.error('Bracket name is required');
      return;
    }

    try {
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
        if (!isNaN(count) && count > 0) {
          body.actual_team_count = count;
        }
      } else {
        body.actual_team_count = null;
      }

      if (formData.weight) {
        const w = parseFloat(formData.weight);
        if (!isNaN(w) && w > 0 && w <= 1) {
          body.weight = w;
        }
      }

      await mutations.update(bracketDetail.id, body);

      toast.success('Bracket updated!');
      setShowEditModal(false);
      await fetchBrackets();
      await fetchBracketDetail(bracketDetail.id);
    } catch (error) {
      console.error('Error updating bracket:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to update bracket',
      );
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
      await mutations.remove(bracket.id);
      toast.success('Bracket deleted');
      if (selectedBracketId === bracket.id) {
        if (selectedEventId) {
          navigate(adminEventPath(selectedEventId, 'brackets'));
        }
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

    try {
      const data = await mutations.generateEntries(
        bracketDetail.id,
        hasEntries,
      );
      toast.success(
        `Generated ${data.entriesCreated} entries (${data.byeCount} byes)`,
      );
      await fetchBracketDetail(bracketDetail.id);
    } catch (error) {
      console.error('Error generating entries:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to generate entries',
      );
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

    try {
      const data = await mutations.generateGames(bracketDetail.id, hasGames);
      toast.success(`Generated ${data.gamesCreated} games`);
      await fetchBracketDetail(bracketDetail.id);
    } catch (error) {
      console.error('Error generating games:', error);
      toast.error(
        error instanceof Error ? error.message : 'Failed to generate games',
      );
    }
  };

  const handleStatusChange = async (newStatus: BracketStatus) => {
    if (!bracketDetail) return;

    try {
      await mutations.changeStatus(bracketDetail.id, newStatus);
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
      weight: bracketDetail.weight?.toString() || '1',
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

  return (
    <div className="brackets-tab">
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

      {selectedBracketId && (
        <>
          {detailLoading ? (
            <p>Loading bracket details...</p>
          ) : bracketDetail ? (
            <BracketDetailView
              bracketDetail={bracketDetail}
              onBack={() => {
                if (selectedEventId) {
                  navigate(adminEventPath(selectedEventId, 'brackets'));
                }
                setBracketDetail(null);
              }}
              adminActions={renderAdminActions(
                bracketDetail,
                handleOpenEditModal,
                handleStatusChange,
              )}
              entriesActions={renderEntriesActions(
                bracketDetail,
                mutations.generatingEntries,
                handleGenerateEntries,
              )}
              gamesActions={renderGamesActions(
                bracketDetail,
                mutations.generatingGames,
                handleGenerateGames,
              )}
              rankings={rankings}
              rankingsWeight={rankingsWeight}
              rankingsLoading={rankingsLoading}
              onRefreshRankings={() => {
                if (selectedBracketId) void refreshRankings(selectedBracketId);
              }}
            />
          ) : (
            <p>Bracket not found.</p>
          )}
        </>
      )}

      {showCreateModal && (
        <BracketCreateModal
          formData={formData}
          setFormData={setFormData}
          saving={mutations.saving}
          createDataLoading={createModal.createDataLoading}
          createTeams={createModal.createTeams}
          createRankings={createModal.createRankings}
          createDoubleSeedingRankings={createModal.createDoubleSeedingRankings}
          createAssigned={createModal.createAssigned}
          selectedTeamIds={createModal.selectedTeamIds}
          setSelectedTeamIds={createModal.setSelectedTeamIds}
          doubleSeedingEnabled={doubleSeedingEnabled}
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreate}
        />
      )}

      {showEditModal && bracketDetail && (
        <BracketEditModal
          formData={formData}
          setFormData={setFormData}
          saving={mutations.saving}
          onClose={() => setShowEditModal(false)}
          onSubmit={handleUpdate}
        />
      )}

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
