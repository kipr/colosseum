/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from 'react';
import ScoreViewModal from './ScoreViewModal';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import { formatDateTime } from '../../utils/dateUtils';

interface ScoreSubmission {
  id: number;
  template_name: string;
  participant_name: string;
  match_id: string;
  created_at: string;
  submitted_to_sheet: boolean;
  status: string;
  reviewed_by: number | null;
  reviewed_at: string | null;
  reviewer_name: string | null;
  score_data: any;
  // Event-scoped fields
  event_id?: number;
  score_type?: 'seeding' | 'bracket';
  bracket_game_id?: number;
  seeding_score_id?: number;
  game_queue_id?: number;
  // Joined display fields from by-event endpoint
  submitted_by?: string;
  team_display_number?: string;
  team_name?: string;
  bracket_name?: string;
  game_number?: number;
  queue_position?: number;
  seeding_round?: number;
}

interface EventScoresResponse {
  rows: ScoreSubmission[];
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

interface AffectedGame {
  id: number;
  game_number: number;
  round_name: string;
  affectedSlot: 'team1' | 'team2' | 'winner';
}

export default function ScoringTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;

  // Shared state
  const [scores, setScores] = useState<ScoreSubmission[]>([]);
  const [editingScore, setEditingScore] = useState<ScoreSubmission | null>(
    null,
  );
  const [loading, setLoading] = useState(true);

  // Event mode state
  const [eventFilterStatus, setEventFilterStatus] = useState<string>('');
  const [eventFilterType, setEventFilterType] = useState<string>('');
  const [eventPage, setEventPage] = useState(1);
  const [eventTotalPages, setEventTotalPages] = useState(1);
  const [eventTotalCount, setEventTotalCount] = useState(0);
  const eventLimit = 50;

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  // Event mode effect
  useEffect(() => {
    if (selectedEventId) {
      loadEventScores(true);

      // Auto-refresh every 10 seconds
      const interval = setInterval(() => {
        loadEventScores(false);
      }, 10000);

      return () => clearInterval(interval);
    }
  }, [
    selectedEventId,
    eventFilterStatus,
    eventFilterType,
    eventPage,
  ]);

  // Load event-scoped scores
  const loadEventScores = async (showLoading = true) => {
    if (!selectedEventId) return;

    if (showLoading) setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(eventPage));
      params.set('limit', String(eventLimit));
      if (eventFilterStatus) params.set('status', eventFilterStatus);
      if (eventFilterType) params.set('score_type', eventFilterType);

      const response = await fetch(
        `/scores/by-event/${selectedEventId}?${params.toString()}`,
        { credentials: 'include' },
      );
      if (!response.ok) throw new Error('Failed to load event scores');

      const data: EventScoresResponse = await response.json();
      setScores(data.rows);
      setEventTotalPages(data.totalPages);
      setEventTotalCount(data.totalCount);
    } catch (error) {
      console.error('Error loading event scores:', error);
      toast.error('Failed to load event scores');
    } finally {
      setLoading(false);
    }
  };

  // Accept event-scoped score
  const handleAcceptEvent = async (id: number, force = false) => {
    try {
      const response = await fetch(`/scores/${id}/accept-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ force }),
      });

      const data = await response.json();

      if (response.status === 409 && !force) {
        // Conflict - ask user to confirm override
        const confirmed = await confirm({
          title: 'Score Conflict',
          message: `A score already exists for this entry.\n\nExisting: ${data.existingScore ?? data.existingWinnerId}\nNew: ${data.newScore ?? data.newWinnerId}\n\nDo you want to override?`,
          confirmText: 'Override',
          confirmStyle: 'warning',
        });
        if (confirmed) {
          return handleAcceptEvent(id, true);
        }
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to accept score');
      }

      if (data.advanced) {
        toast.success(
          `Score accepted. Winner advanced to game ${data.advancedTo || 'next round'}.`,
        );
      } else {
        toast.success('Score accepted successfully');
      }

      loadEventScores(false);
    } catch (error: any) {
      console.error('Error accepting event score:', error);
      toast.error(error.message || 'Failed to accept score');
    }
  };

  // Revert event-scoped score
  const handleRevertEvent = async (id: number, confirm_revert = false) => {
    try {
      // First, do a dry-run to check for cascading effects
      const dryRunResponse = await fetch(`/scores/${id}/revert-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ dryRun: true }),
      });

      const dryRunData = await dryRunResponse.json();

      if (!dryRunResponse.ok) {
        throw new Error(dryRunData.error || 'Failed to check revert');
      }

      // If cascade confirmation is required
      if (dryRunData.requiresConfirmation && !confirm_revert) {
        const affectedGames: AffectedGame[] = dryRunData.affectedGames || [];
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
      } else if (!confirm_revert) {
        // Simple confirmation for non-cascade revert
        const confirmed = await confirm({
          title: 'Revert Score',
          message: 'Are you sure you want to revert this score to pending?',
          confirmText: 'Revert',
          confirmStyle: 'warning',
        });
        if (!confirmed) return;
      }

      // Apply the revert
      const response = await fetch(`/scores/${id}/revert-event`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ confirm: true }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to revert score');
      }

      if (data.revertedGames && data.revertedGames > 1) {
        toast.success(`Score reverted. ${data.revertedGames} games affected.`);
      } else {
        toast.success('Score reverted successfully');
      }

      loadEventScores(false);
    } catch (error: any) {
      console.error('Error reverting event score:', error);
      toast.error(error.message || 'Failed to revert score');
    }
  };

  const handleReject = async (id: number) => {
    const confirmed = await confirm({
      title: 'Reject Score',
      message: 'Are you sure you want to reject this score?',
      confirmText: 'Reject',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;

    try {
      const response = await fetch(`/scores/${id}/reject`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to reject score');
      loadEventScores(false);
    } catch (error) {
      console.error('Error rejecting score:', error);
      toast.error('Failed to reject score');
    }
  };

  const handleEdit = (score: ScoreSubmission) => {
    setEditingScore(score);
  };

  const handleScoreUpdated = () => {
    setEditingScore(null);
    loadEventScores(false);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'accepted':
        return <span className="badge badge-success">Accepted</span>;
      case 'rejected':
        return <span className="badge badge-danger">Rejected</span>;
      default:
        return <span className="badge badge-warning">Pending</span>;
    }
  };

  // Render table for event-scoped scores
  const renderEventTable = () => (
    <table>
      <thead>
        <tr>
          <th>Type</th>
          <th>Team</th>
          <th>Context</th>
          <th>Total</th>
          <th>Submitted By</th>
          <th>Submitted</th>
          <th>Status</th>
          <th>Reviewed</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {scores.map((score) => {
          const data = score.score_data || {};
          const scoreType = score.score_type || 'unknown';
          const totalScore =
            data.grand_total?.value ??
            data.team_a_total?.value ??
            data.score?.value ??
            '-';

          // Context display
          let context = '-';
          if (scoreType === 'seeding') {
            const round = score.seeding_round || data.round?.value;
            context = round ? `Round ${round}` : '-';
          } else if (scoreType === 'bracket') {
            const bracketName = score.bracket_name || 'Bracket';
            const gameNum = score.game_number || data.game_number?.value;
            context = gameNum
              ? `${bracketName} - Game ${gameNum}`
              : bracketName;
          }

          // Team display
          const teamNum =
            score.team_display_number ||
            data.team_number?.value ||
            data.team_a_number?.value ||
            '-';
          const teamName =
            score.team_name ||
            data.team_name?.value ||
            data.team_a_name?.value ||
            '';

          return (
            <tr key={score.id}>
              <td>
                <span
                  className={`badge ${scoreType === 'seeding' ? 'badge-info' : 'badge-purple'}`}
                >
                  {scoreType === 'seeding' ? 'Seeding' : 'Bracket'}
                </span>
              </td>
              <td>
                <div>
                  <strong>{teamNum}</strong>
                </div>
                {teamName && (
                  <small style={{ color: 'var(--text-secondary)' }}>
                    {teamName}
                  </small>
                )}
              </td>
              <td>{context}</td>
              <td>
                <strong style={{ color: 'var(--primary-color)' }}>
                  {totalScore}
                </strong>
              </td>
              <td>{score.submitted_by || '-'}</td>
              <td>{formatDateTime(score.created_at)}</td>
              <td>{getStatusBadge(score.status)}</td>
              <td>
                {score.reviewer_name || '-'}
                {score.reviewed_at && (
                  <>
                    <br />
                    <small>{formatDateTime(score.reviewed_at)}</small>
                  </>
                )}
              </td>
              <td>{renderEventActions(score)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  // Render actions for event-scoped scores
  const renderEventActions = (score: ScoreSubmission) => (
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
            onClick={() => handleEdit(score)}
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
            onClick={() => handleEdit(score)}
            style={{ fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
          >
            View
          </button>
        </>
      )}
    </div>
  );

  // Render pagination controls for event mode
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

      {/* Event Controls */}
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
            <div style={{ marginLeft: 'auto' }}>
              <button
                className="btn btn-secondary"
                onClick={() => loadEventScores(true)}
                style={{ padding: '0.5rem 1rem' }}
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

      {/* Event Content */}
      <>
          {!selectedEventId ? (
            <p>
              Please select an event from the top navigation to view scores.
            </p>
          ) : loading ? (
            <p>Loading scores...</p>
          ) : scores.length === 0 ? (
            <p>No scores found for this event with the selected filters.</p>
          ) : (
            <>
              {renderEventTable()}
              {eventTotalPages > 1 && renderEventPagination()}
            </>
          )}
      </>

      {editingScore && (
        <ScoreViewModal
          score={editingScore}
          onClose={() => setEditingScore(null)}
          onSave={handleScoreUpdated}
        />
      )}

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
