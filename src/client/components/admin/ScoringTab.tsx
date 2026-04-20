import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UnifiedTable } from '../table';
import ScoreViewModal from './ScoreViewModal';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import { apiSend } from '../../utils/apiClient';
import '../Modal.css';
import './ScoringTab.css';
import {
  buildBracketColumns,
  buildSeedingColumns,
} from './scoring/scoringColumns';
import { useEventScores } from './scoring/useEventScores';
import { BulkAcceptModal } from './scoring/BulkAcceptModal';
import type { AffectedGame, ScoreSubmission } from './scoring/types';

const EVENT_LIMIT = 50;

export default function ScoringTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;

  const [editingScore, setEditingScore] = useState<ScoreSubmission | null>(
    null,
  );

  const [searchParams, setSearchParams] = useSearchParams();
  const eventPage = Math.max(1, Number(searchParams.get('page')) || 1);
  const setEventPage = useCallback(
    (updater: number | ((prev: number) => number)) => {
      const next = typeof updater === 'function' ? updater(eventPage) : updater;
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next <= 1) p.delete('page');
          else p.set('page', String(next));
          return p;
        },
        { replace: true },
      );
    },
    [eventPage, setSearchParams],
  );

  const [eventFilterStatus, setEventFilterStatus] = useState<string>('');
  const [eventFilterType, setEventFilterType] = useState<string>('');

  const [showBulkAccept, setShowBulkAccept] = useState(false);
  const [bulkAccepting, setBulkAccepting] = useState(false);

  const { confirm, ConfirmDialog } = useConfirm();
  const {
    error: toastError,
    success: toastSuccess,
    warning: toastWarning,
    ToastContainer,
  } = useToast();

  const handleError = useCallback(
    (message: string) => toastError(message),
    [toastError],
  );

  const {
    scores,
    loading,
    totalPages: eventTotalPages,
    totalCount: eventTotalCount,
    reload,
  } = useEventScores({
    eventId: selectedEventId,
    page: eventPage,
    limit: EVENT_LIMIT,
    filterStatus: eventFilterStatus,
    filterType: eventFilterType,
    onError: handleError,
  });

  const pendingScores = useMemo(
    () => scores.filter((s) => s.status === 'pending'),
    [scores],
  );
  const seedingScores = useMemo(
    () => scores.filter((s) => s.score_type === 'seeding'),
    [scores],
  );
  const bracketScores = useMemo(
    () => scores.filter((s) => s.score_type === 'bracket'),
    [scores],
  );

  const handleAcceptEvent = useCallback(
    async (id: number, force = false): Promise<void> => {
      try {
        const data = await apiSend<{
          advanced?: boolean;
          advancedTo?: number | string;
        }>('POST', `/scores/${id}/accept-event`, { force });
        if (data.advanced) {
          toastSuccess(
            `Score accepted. Winner advanced to game ${data.advancedTo || 'next round'}.`,
          );
        } else {
          toastSuccess('Score accepted successfully');
        }
        reload(false);
      } catch (error) {
        const apiErr = error as {
          status?: number;
          body?: {
            existingScore?: unknown;
            existingWinnerId?: unknown;
            newScore?: unknown;
            newWinnerId?: unknown;
            error?: string;
          };
          message?: string;
        };
        if (apiErr.status === 409 && !force) {
          const body = apiErr.body ?? {};
          const confirmed = await confirm({
            title: 'Score Conflict',
            message: `A score already exists for this entry.\n\nExisting: ${body.existingScore ?? body.existingWinnerId}\nNew: ${body.newScore ?? body.newWinnerId}\n\nDo you want to override?`,
            confirmText: 'Override',
            confirmStyle: 'warning',
          });
          if (confirmed) await handleAcceptEvent(id, true);
          return;
        }
        console.error('Error accepting event score:', error);
        toastError(apiErr.message || 'Failed to accept score');
      }
    },
    [confirm, reload, toastSuccess, toastError],
  );

  const handleRevertEvent = useCallback(
    async (id: number) => {
      try {
        const dryRunData = await apiSend<{
          requiresConfirmation?: boolean;
          affectedGames?: AffectedGame[];
        }>('POST', `/scores/${id}/revert-event`, { dryRun: true });

        if (dryRunData.requiresConfirmation) {
          const affectedGames = dryRunData.affectedGames || [];
          const gamesList = affectedGames
            .map(
              (g) =>
                `• Game ${g.game_number} (${g.round_name}): ${g.affectedSlot}`,
            )
            .join('\n');
          const confirmed = await confirm({
            title: 'Confirm Cascade Revert',
            message: `Reverting this score will affect ${affectedGames.length} downstream game(s):\n\n${gamesList}\n\nAre you sure you want to proceed?`,
            confirmText: 'Revert All',
            confirmStyle: 'danger',
          });
          if (!confirmed) return;
        } else {
          const confirmed = await confirm({
            title: 'Revert Score',
            message: 'Are you sure you want to revert this score to pending?',
            confirmText: 'Revert',
            confirmStyle: 'warning',
          });
          if (!confirmed) return;
        }

        const data = await apiSend<{ revertedGames?: number }>(
          'POST',
          `/scores/${id}/revert-event`,
          { confirm: true },
        );
        if (data.revertedGames && data.revertedGames > 1) {
          toastSuccess(`Score reverted. ${data.revertedGames} games affected.`);
        } else {
          toastSuccess('Score reverted successfully');
        }
        reload(false);
      } catch (error) {
        console.error('Error reverting event score:', error);
        toastError(
          error instanceof Error ? error.message : 'Failed to revert score',
        );
      }
    },
    [confirm, reload, toastSuccess, toastError],
  );

  const handleReject = useCallback(
    async (id: number) => {
      const confirmed = await confirm({
        title: 'Reject Score',
        message: 'Are you sure you want to reject this score?',
        confirmText: 'Reject',
        confirmStyle: 'danger',
      });
      if (!confirmed) return;
      try {
        await apiSend('POST', `/scores/${id}/reject`);
        reload(false);
      } catch (error) {
        console.error('Error rejecting score:', error);
        toastError('Failed to reject score');
      }
    },
    [confirm, reload, toastError],
  );

  const handleBulkAccept = useCallback(
    async (selectedIds: number[]) => {
      if (selectedIds.length === 0 || !selectedEventId) return;
      setBulkAccepting(true);
      try {
        const data = await apiSend<{
          accepted: number;
          skipped?: unknown[];
        }>('POST', `/scores/event/${selectedEventId}/accept/bulk`, {
          score_ids: selectedIds,
        });
        toastSuccess(`Accepted ${data.accepted} score(s)`);
        if (data.skipped && data.skipped.length > 0) {
          toastWarning(`${data.skipped.length} score(s) skipped (conflicts)`);
        }
        setShowBulkAccept(false);
        reload(false);
      } catch (error) {
        console.error('Error bulk accepting scores:', error);
        toastError(
          error instanceof Error ? error.message : 'Failed to accept scores',
        );
      } finally {
        setBulkAccepting(false);
      }
    },
    [selectedEventId, reload, toastSuccess, toastWarning, toastError],
  );

  const renderEventActions = useCallback(
    (score: ScoreSubmission) => (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.25rem',
          width: '160px',
          minWidth: '160px',
        }}
      >
        {score.status === 'pending' ? (
          <>
            <button
              className="btn btn-primary"
              onClick={() => handleAcceptEvent(score.id)}
              style={{ fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
            >
              Accept
            </button>
            <button
              className="btn btn-danger"
              onClick={() => handleReject(score.id)}
              style={{ fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
            >
              Reject
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setEditingScore(score)}
              style={{
                fontSize: '0.85rem',
                padding: '0.4rem 0.6rem',
                gridColumn: '1 / 3',
              }}
            >
              View Details
            </button>
          </>
        ) : (
          <>
            <button
              className="btn btn-secondary"
              onClick={() => handleRevertEvent(score.id)}
              style={{ fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
            >
              Revert
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => setEditingScore(score)}
              style={{ fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
            >
              View
            </button>
          </>
        )}
      </div>
    ),
    [handleAcceptEvent, handleReject, handleRevertEvent],
  );

  const renderSeedingTable = (rows: ScoreSubmission[], showType: boolean) => (
    <UnifiedTable
      columns={buildSeedingColumns({
        showType,
        renderActions: renderEventActions,
      })}
      rows={rows}
      getRowKey={(s) => s.id}
      headerLabelVariant="none"
    />
  );

  const renderBracketTable = (rows: ScoreSubmission[], showType: boolean) => (
    <UnifiedTable
      columns={buildBracketColumns({
        showType,
        renderActions: renderEventActions,
      })}
      rows={rows}
      getRowKey={(s) => s.id}
      headerLabelVariant="none"
    />
  );

  const renderEventTables = () => {
    if (eventFilterType === 'seeding') return renderSeedingTable(scores, false);
    if (eventFilterType === 'bracket') return renderBracketTable(scores, false);
    return (
      <>
        {seedingScores.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ margin: '0.5rem 0' }}>Seeding Scores</h4>
            {renderSeedingTable(seedingScores, false)}
          </div>
        )}
        {bracketScores.length > 0 && (
          <div>
            <h4 style={{ margin: '0.5rem 0' }}>Bracket Scores</h4>
            {renderBracketTable(bracketScores, false)}
          </div>
        )}
      </>
    );
  };

  const renderEventPagination = () => (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginTop: '1rem',
        padding: '0.5rem',
        background: 'var(--card-bg)',
        borderRadius: '0.5rem',
      }}
    >
      <span style={{ color: 'var(--text-secondary)' }}>
        Showing {scores.length} of {eventTotalCount} scores
      </span>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <button
          className="btn btn-secondary"
          onClick={() => setEventPage((p) => Math.max(1, p - 1))}
          disabled={eventPage <= 1}
          style={{ padding: '0.4rem 0.8rem' }}
        >
          Previous
        </button>
        <span>
          Page {eventPage} of {eventTotalPages || 1}
        </span>
        <button
          className="btn btn-secondary"
          onClick={() => setEventPage((p) => Math.min(eventTotalPages, p + 1))}
          disabled={eventPage >= eventTotalPages}
          style={{ padding: '0.4rem 0.8rem' }}
        >
          Next
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <h2>Scoring</h2>

      <div className="card">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: '150px' }}>
            <label>Status:</label>
            <select
              className="field-input"
              value={eventFilterStatus}
              onChange={(e) => {
                setEventFilterStatus(e.target.value);
                setEventPage(1);
              }}
            >
              <option value="">All</option>
              <option value="pending">Pending</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
            </select>
          </div>
          <div style={{ minWidth: '150px' }}>
            <label>Score Type:</label>
            <select
              className="field-input"
              value={eventFilterType}
              onChange={(e) => {
                setEventFilterType(e.target.value);
                setEventPage(1);
              }}
            >
              <option value="">All</option>
              <option value="seeding">Seeding</option>
              <option value="bracket">Bracket</option>
            </select>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-success"
              onClick={() => setShowBulkAccept(true)}
              disabled={pendingScores.length === 0}
              title={
                pendingScores.length === 0
                  ? 'No pending scores to accept'
                  : `Accept ${pendingScores.length} pending score(s)`
              }
              style={{ padding: '0.5rem 1rem' }}
            >
              Bulk Accept
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => reload(true)}
              style={{ padding: '0.5rem 1rem' }}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {!selectedEventId ? (
        <p>Please select an event from the top navigation to view scores.</p>
      ) : loading ? (
        <p>Loading scores...</p>
      ) : scores.length === 0 ? (
        <p>No scores found for this event with the selected filters.</p>
      ) : (
        <>
          {renderEventTables()}
          {eventTotalPages > 1 && renderEventPagination()}
        </>
      )}

      {editingScore && (
        <ScoreViewModal
          score={editingScore}
          onClose={() => setEditingScore(null)}
          onSave={() => {
            setEditingScore(null);
            reload(false);
          }}
        />
      )}

      <BulkAcceptModal
        open={showBulkAccept}
        pendingScores={pendingScores}
        accepting={bulkAccepting}
        onClose={() => setShowBulkAccept(false)}
        onAccept={handleBulkAccept}
      />

      {ConfirmDialog}
      {ToastContainer}
    </div>
  );
}
