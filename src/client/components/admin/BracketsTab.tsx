import { useCallback, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import {
  adminBracketPath,
  adminEventPath,
  isBracketDetailView,
  type BracketDetailView as BracketDetailViewType,
} from '../../utils/routes';
import type {
  Bracket,
  BracketDetail,
  BracketStatus,
} from '../../types/brackets';
import BracketListTable from '../bracket/BracketListTable';
import BracketDetailView from '../bracket/BracketDetailView';
import { apiSend, isApiError } from '../../utils/apiClient';
import '../Modal.css';
import './BracketsTab.css';
import { useBracketsList } from './brackets/useBracketsList';
import { useBracketDetail } from './brackets/useBracketDetail';
import { useBracketRankings } from './brackets/useBracketRankings';
import {
  CreateBracketModal,
  type CreateBracketSubmit,
} from './brackets/CreateBracketModal';
import {
  EditBracketModal,
  type EditBracketSubmit,
} from './brackets/EditBracketModal';
import {
  renderAdminActions,
  renderEntriesActions,
  renderGamesActions,
  statusLabel,
} from './brackets/bracketAdminActions';

interface CreateConflict {
  team_name: string;
  bracket_name: string;
}

export default function BracketsTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;
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

  const { confirm, ConfirmDialog } = useConfirm();
  const {
    error: toastError,
    success: toastSuccess,
    ToastContainer,
  } = useToast();
  const handleError = useCallback(
    (message: string) => toastError(message),
    [toastError],
  );

  const {
    brackets,
    loading,
    refetch: refetchBrackets,
  } = useBracketsList(selectedEventId, handleError);

  const handleNotFound = useCallback(() => {
    if (selectedEventId) {
      navigate(adminEventPath(selectedEventId, 'brackets'), { replace: true });
    }
  }, [selectedEventId, navigate]);

  const {
    bracketDetail,
    setBracketDetail,
    rankings: detailRankings,
    rankingsWeight: detailRankingsWeight,
    loading: detailLoading,
    refetch: refetchBracketDetail,
  } = useBracketDetail(selectedBracketId, handleError, handleNotFound);

  const {
    rankings: refreshedRankings,
    rankingsWeight: refreshedRankingsWeight,
    loading: rankingsLoading,
    refresh: refreshRankings,
  } = useBracketRankings(handleError);

  const rankings = refreshedRankings ?? detailRankings;
  const rankingsWeight = refreshedRankings
    ? refreshedRankingsWeight
    : detailRankingsWeight;

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatingEntries, setGeneratingEntries] = useState(false);
  const [generatingGames, setGeneratingGames] = useState(false);

  const handleCreate = async (data: CreateBracketSubmit) => {
    if (!selectedEventId) return;
    setSaving(true);
    try {
      const created = await apiSend<{ id?: number }>('POST', '/brackets', {
        event_id: selectedEventId,
        ...data,
      });
      toastSuccess('Bracket created!');
      setShowCreateModal(false);
      await refetchBrackets();
      if (created?.id) setSelectedBracketId(created.id);
    } catch (error) {
      console.error('Error creating bracket:', error);
      if (isApiError(error) && error.status === 409) {
        const conflicts =
          (error.body as { conflicts?: CreateConflict[] } | null)?.conflicts ??
          [];
        if (conflicts.length > 0) {
          const names = conflicts
            .map((c) => `${c.team_name} (in ${c.bracket_name})`)
            .join(', ');
          toastError(
            `Teams already in another bracket: ${names}. Remove them from selection.`,
          );
          return;
        }
      }
      toastError(
        error instanceof Error ? error.message : 'Failed to create bracket',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (data: EditBracketSubmit) => {
    if (!bracketDetail) return;
    setSaving(true);
    try {
      await apiSend('PATCH', `/brackets/${bracketDetail.id}`, data);
      toastSuccess('Bracket updated!');
      setShowEditModal(false);
      await refetchBrackets();
      await refetchBracketDetail();
    } catch (error) {
      console.error('Error updating bracket:', error);
      toastError(
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
      await apiSend('DELETE', `/brackets/${bracket.id}`);
      toastSuccess('Bracket deleted');
      if (selectedBracketId === bracket.id) {
        if (selectedEventId) {
          navigate(adminEventPath(selectedEventId, 'brackets'));
        }
        setBracketDetail(null);
      }
      await refetchBrackets();
    } catch (error) {
      console.error('Error deleting bracket:', error);
      toastError(
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
      const data = await apiSend<{
        entriesCreated: number;
        byeCount: number;
      }>('POST', url);
      toastSuccess(
        `Generated ${data.entriesCreated} entries (${data.byeCount} byes)`,
      );
      await refetchBracketDetail();
    } catch (error) {
      console.error('Error generating entries:', error);
      toastError(
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
      const data = await apiSend<{ gamesCreated: number }>('POST', url);
      toastSuccess(`Generated ${data.gamesCreated} games`);
      await refetchBracketDetail();
    } catch (error) {
      console.error('Error generating games:', error);
      toastError(
        error instanceof Error ? error.message : 'Failed to generate games',
      );
    } finally {
      setGeneratingGames(false);
    }
  };

  const handleStatusChange = async (newStatus: BracketStatus) => {
    if (!bracketDetail) return;
    try {
      await apiSend('PATCH', `/brackets/${bracketDetail.id}`, {
        status: newStatus,
      });
      toastSuccess(`Bracket status updated to ${statusLabel(newStatus)}`);
      await refetchBrackets();
      await refetchBracketDetail();
    } catch (error) {
      console.error('Error updating bracket status:', error);
      toastError(
        error instanceof Error ? error.message : 'Failed to update status',
      );
    }
  };

  const editingBracket: BracketDetail | null = showEditModal
    ? bracketDetail
    : null;

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
              onClick={() => setShowCreateModal(true)}
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
              adminActions={renderAdminActions({
                bracketDetail,
                onEdit: () => setShowEditModal(true),
                onStatusChange: handleStatusChange,
              })}
              entriesActions={renderEntriesActions({
                bracketDetail,
                generating: generatingEntries,
                onGenerate: handleGenerateEntries,
              })}
              gamesActions={renderGamesActions({
                bracketDetail,
                generating: generatingGames,
                onGenerate: handleGenerateGames,
              })}
              rankings={rankings}
              rankingsWeight={rankingsWeight}
              rankingsLoading={rankingsLoading}
              onRefreshRankings={() => {
                if (selectedBracketId) refreshRankings(selectedBracketId);
              }}
            />
          ) : (
            <p>Bracket not found.</p>
          )}
        </>
      )}

      <CreateBracketModal
        open={showCreateModal}
        eventId={selectedEventId}
        seedingRounds={selectedEvent?.seeding_rounds ?? 3}
        saving={saving}
        onClose={() => setShowCreateModal(false)}
        onError={handleError}
        onSubmit={handleCreate}
      />

      <EditBracketModal
        open={showEditModal}
        bracket={editingBracket}
        saving={saving}
        onClose={() => setShowEditModal(false)}
        onError={handleError}
        onSubmit={handleUpdate}
      />

      {ConfirmDialog}
      {ToastContainer}
    </div>
  );
}
