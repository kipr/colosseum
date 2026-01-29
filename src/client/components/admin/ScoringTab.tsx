/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from 'react';
import ScoreViewModal from './ScoreViewModal';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { formatDateTime } from '../../utils/dateUtils';

interface SpreadsheetConfig {
  id: number;
  spreadsheet_name: string;
  sheet_name: string;
  sheet_purpose: string;
  is_active: boolean;
  auto_accept: boolean;
}

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
}

export default function ScoringTab() {
  const [spreadsheets, setSpreadsheets] = useState<SpreadsheetConfig[]>([]);
  const [selectedSpreadsheet, setSelectedSpreadsheet] = useState<number | null>(
    null,
  );
  const [selectedPurpose, setSelectedPurpose] = useState<string>('');
  const [scores, setScores] = useState<ScoreSubmission[]>([]);
  const [editingScore, setEditingScore] = useState<ScoreSubmission | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [processingAutoAccept, setProcessingAutoAccept] = useState(false);

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  // Get auto-accept status for selected sheet from spreadsheets state
  const selectedSheet = spreadsheets.find((s) => s.id === selectedSpreadsheet);
  const autoAccept = selectedSheet?.auto_accept ?? false;

  // Toggle auto-accept and save to database
  const toggleAutoAccept = async () => {
    if (!selectedSpreadsheet) return;

    const newValue = !autoAccept;
    try {
      const response = await fetch(
        `/admin/spreadsheets/${selectedSpreadsheet}/auto-accept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ enabled: newValue }),
        },
      );

      if (!response.ok) throw new Error('Failed to update');

      // Update local state
      setSpreadsheets((prev) =>
        prev.map((s) =>
          s.id === selectedSpreadsheet ? { ...s, auto_accept: newValue } : s,
        ),
      );

      if (newValue) {
        toast.success('Auto-accept enabled for this sheet');
      } else {
        toast.info('Auto-accept disabled for this sheet');
      }
    } catch (error) {
      console.error('Error toggling auto-accept:', error);
      toast.error('Failed to update auto-accept setting');
    }
  };

  useEffect(() => {
    loadSpreadsheets();
  }, []);

  useEffect(() => {
    if (selectedSpreadsheet) {
      // Save to localStorage for next time
      localStorage.setItem(
        'colosseum_last_scoring_sheet',
        selectedSpreadsheet.toString(),
      );

      loadScores(true); // Show loading on initial load
      // Get the purpose of the selected spreadsheet
      const selected = spreadsheets.find((s) => s.id === selectedSpreadsheet);
      setSelectedPurpose(selected?.sheet_purpose || '');

      // Auto-refresh scores every 10 seconds (without loading spinner)
      const interval = setInterval(() => {
        loadScores(false);
      }, 10000);

      return () => clearInterval(interval);
    }
  }, [selectedSpreadsheet]);

  const loadSpreadsheets = async () => {
    try {
      const response = await fetch('/admin/spreadsheets?shared=true', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to load spreadsheets');
      const data = await response.json();

      // Filter to show score submission and bracket sheets
      const scoringSheets = data.filter(
        (s: SpreadsheetConfig) =>
          s.sheet_purpose === 'scores' || s.sheet_purpose === 'bracket',
      );
      setSpreadsheets(scoringSheets);

      // Try to restore last selected sheet from localStorage
      const lastSelectedId = localStorage.getItem(
        'colosseum_last_scoring_sheet',
      );
      let sheetToSelect = null;

      if (lastSelectedId) {
        // Check if the last selected sheet still exists
        sheetToSelect = scoringSheets.find(
          (s: SpreadsheetConfig) => s.id === parseInt(lastSelectedId, 10),
        );
      }

      // If no last selected or it doesn't exist, auto-select first active sheet
      if (!sheetToSelect) {
        sheetToSelect = scoringSheets.find(
          (s: SpreadsheetConfig) => s.is_active,
        );
      }

      // Fall back to first sheet if no active sheets
      if (!sheetToSelect && scoringSheets.length > 0) {
        sheetToSelect = scoringSheets[0];
      }

      if (sheetToSelect) {
        setSelectedSpreadsheet(sheetToSelect.id);
      }
    } catch (error) {
      console.error('Error loading spreadsheets:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadScores = async (
    showLoading = true,
    currentSpreadsheets?: SpreadsheetConfig[],
  ) => {
    if (!selectedSpreadsheet) return;

    if (showLoading) setLoading(true);
    try {
      const response = await fetch(
        `/scores/by-spreadsheet/${selectedSpreadsheet}`,
        {
          credentials: 'include',
        },
      );
      if (!response.ok) throw new Error('Failed to load scores');
      const data = await response.json();
      setScores(data);

      // Get current auto-accept status for this sheet (use passed spreadsheets or current state)
      const sheetsToCheck = currentSpreadsheets || spreadsheets;
      const currentSheet = sheetsToCheck.find(
        (s) => s.id === selectedSpreadsheet,
      );
      const isAutoAcceptEnabled = currentSheet?.auto_accept ?? false;

      // Auto-accept pending scores if enabled for this sheet
      if (isAutoAcceptEnabled && !processingAutoAccept) {
        const pendingScores = data.filter(
          (s: ScoreSubmission) => s.status === 'pending',
        );
        if (pendingScores.length > 0) {
          setProcessingAutoAccept(true);
          for (const score of pendingScores) {
            try {
              await fetch(`/scores/${score.id}/accept`, {
                method: 'POST',
                credentials: 'include',
              });
            } catch (error) {
              console.error('Auto-accept failed for score:', score.id, error);
            }
          }
          setProcessingAutoAccept(false);
          // Reload to show updated statuses
          loadScores(false, sheetsToCheck);
        }
      }
    } catch (error) {
      console.error('Error loading scores:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async (id: number) => {
    try {
      const response = await fetch(`/scores/${id}/accept`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to accept score');
      }
      // Don't show loading to preserve scroll position
      loadScores(false);
    } catch (error: any) {
      console.error('Error accepting score:', error);
      toast.error(error.message || 'Failed to accept score');
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
      // Don't show loading to preserve scroll position
      loadScores(false);
    } catch (error) {
      console.error('Error rejecting score:', error);
      toast.error('Failed to reject score');
    }
  };

  const handleRevert = async (id: number) => {
    const confirmed = await confirm({
      title: 'Revert Score',
      message: 'Are you sure you want to revert this score to pending?',
      confirmText: 'Revert',
      confirmStyle: 'warning',
    });
    if (!confirmed) return;

    try {
      const response = await fetch(`/scores/${id}/revert`, {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to revert score');
      // Don't show loading to preserve scroll position
      loadScores(false);
    } catch (error) {
      console.error('Error reverting score:', error);
      toast.error('Failed to revert score');
    }
  };

  const handleDelete = async (id: number) => {
    const confirmed = await confirm({
      title: 'Delete Score',
      message:
        'Are you sure you want to permanently delete this score? This cannot be undone.',
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;

    try {
      const response = await fetch(`/scores/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete score');
      // Don't show loading to preserve scroll position
      loadScores(false);
    } catch (error) {
      console.error('Error deleting score:', error);
      toast.error('Failed to delete score');
    }
  };

  const handleEdit = (score: ScoreSubmission) => {
    setEditingScore(score);
  };

  const handleScoreUpdated = () => {
    setEditingScore(null);
    // Don't show loading to preserve scroll position
    loadScores(false);
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

  const getPurposeLabel = (purpose: string) => {
    switch (purpose) {
      case 'scores':
        return 'Seeding';
      case 'bracket':
        return 'DE Bracket';
      default:
        return purpose;
    }
  };

  // Check if a score is from a head-to-head (DE) match
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const isHeadToHead = (score: ScoreSubmission) => {
    return score.score_data?._isHeadToHead?.value === true;
  };

  // Render table for seeding scores
  const renderSeedingTable = () => (
    <table>
      <thead>
        <tr>
          <th>Template</th>
          <th>Team #</th>
          <th>Team Name</th>
          <th>Round</th>
          <th>Total Score</th>
          <th>Submitted</th>
          <th>Status</th>
          <th>Reviewed By</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {scores.map((score) => (
          <tr key={score.id}>
            <td>{score.template_name}</td>
            <td>{score.score_data?.team_number?.value || '-'}</td>
            <td>
              {score.participant_name ||
                score.score_data?.team_name?.value ||
                '-'}
            </td>
            <td>{score.match_id || score.score_data?.round?.value || '-'}</td>
            <td>
              <strong style={{ color: 'var(--primary-color)' }}>
                {score.score_data?.grand_total?.value || 0}
              </strong>
            </td>
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
            <td>{renderActions(score)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  // Render table for DE bracket scores
  const renderBracketTable = () => (
    <table>
      <thead>
        <tr>
          <th>Template</th>
          <th>Game</th>
          <th>Team A</th>
          <th>Score A</th>
          <th>Team B</th>
          <th>Score B</th>
          <th>Winner</th>
          <th>Submitted</th>
          <th>Status</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {scores.map((score) => {
          const data = score.score_data || {};
          const teamANum = data.team_a_number?.value || '-';
          const teamAName = data.team_a_name?.value || '';
          const teamBNum = data.team_b_number?.value || '-';
          const teamBName = data.team_b_name?.value || '';
          const teamAScore = data.team_a_total?.value || 0;
          const teamBScore = data.team_b_total?.value || 0;
          const winnerNum = data.winner_team_number?.value || '-';
          const winnerName = data.winner_team_name?.value || '';
          const gameNum = data.game_number?.value || score.match_id || '-';

          return (
            <tr key={score.id}>
              <td>{score.template_name}</td>
              <td>
                <strong>Game {gameNum}</strong>
              </td>
              <td>
                <div>
                  <strong>{teamANum}</strong>
                </div>
                {teamAName && (
                  <small style={{ color: 'var(--text-secondary)' }}>
                    {teamAName}
                  </small>
                )}
              </td>
              <td style={{ textAlign: 'center' }}>
                <span
                  style={{
                    fontWeight: winnerNum === teamANum ? 700 : 400,
                    color:
                      winnerNum === teamANum
                        ? 'var(--success-color)'
                        : 'inherit',
                  }}
                >
                  {teamAScore}
                </span>
              </td>
              <td>
                <div>
                  <strong>{teamBNum}</strong>
                </div>
                {teamBName && (
                  <small style={{ color: 'var(--text-secondary)' }}>
                    {teamBName}
                  </small>
                )}
              </td>
              <td style={{ textAlign: 'center' }}>
                <span
                  style={{
                    fontWeight: winnerNum === teamBNum ? 700 : 400,
                    color:
                      winnerNum === teamBNum
                        ? 'var(--success-color)'
                        : 'inherit',
                  }}
                >
                  {teamBScore}
                </span>
              </td>
              <td>
                <div>
                  <strong style={{ color: 'var(--success-color)' }}>
                    {winnerNum}
                  </strong>
                </div>
                {winnerName && (
                  <small style={{ color: 'var(--success-color)' }}>
                    {winnerName}
                  </small>
                )}
              </td>
              <td>{formatDateTime(score.created_at)}</td>
              <td>{getStatusBadge(score.status)}</td>
              <td>{renderActions(score)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );

  const renderActions = (score: ScoreSubmission) => (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '0.25rem',
        width: '200px',
        minWidth: '200px',
      }}
    >
      {score.status === 'pending' ? (
        <>
          <button
            className="btn btn-primary"
            onClick={() => handleAccept(score.id)}
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
            style={{ fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
          >
            Edit
          </button>
          <button
            className="btn btn-delete"
            onClick={() => handleDelete(score.id)}
            title="Permanently delete"
            style={{
              fontSize: '0.85rem',
              padding: '0.4rem 0.6rem',
            }}
          >
            Delete
          </button>
        </>
      ) : (
        <>
          <button
            className="btn btn-secondary"
            onClick={() => handleRevert(score.id)}
            style={{
              fontSize: '0.85rem',
              padding: '0.4rem 0.6rem',
              gridColumn: '1 / 2',
            }}
          >
            Revert
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleEdit(score)}
            style={{
              fontSize: '0.85rem',
              padding: '0.4rem 0.6rem',
              gridColumn: '2 / 3',
            }}
          >
            View
          </button>
          <button
            className="btn btn-delete"
            onClick={() => handleDelete(score.id)}
            title="Permanently delete"
            style={{
              fontSize: '0.85rem',
              padding: '0.4rem 0.6rem',
              gridColumn: '1 / 3',
            }}
          >
            Delete
          </button>
        </>
      )}
    </div>
  );

  return (
    <div>
      <h2>Scoring</h2>

      <div className="card">
        <div
          className="form-group"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ flex: 1, minWidth: '300px' }}>
            <label>Select Sheet:</label>
            <select
              className="field-input"
              value={selectedSpreadsheet || ''}
              onChange={(e) => setSelectedSpreadsheet(Number(e.target.value))}
              style={{ maxWidth: '500px' }}
            >
              <option value="">Select a sheet...</option>
              {spreadsheets.map((config) => (
                <option key={config.id} value={config.id}>
                  [{getPurposeLabel(config.sheet_purpose)}]{' '}
                  {config.spreadsheet_name} → {config.sheet_name}{' '}
                  {config.is_active ? '(Active)' : ''}
                </option>
              ))}
            </select>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              background: autoAccept
                ? 'var(--success-bg, rgba(34, 197, 94, 0.1))'
                : 'var(--bg-color)',
              borderRadius: '0.5rem',
              border: autoAccept
                ? '2px solid var(--success-color)'
                : '1px solid var(--border-color)',
            }}
          >
            <label
              htmlFor="autoAcceptToggle"
              style={{
                cursor: 'pointer',
                fontWeight: autoAccept ? 600 : 400,
                color: autoAccept ? 'var(--success-color)' : 'inherit',
              }}
            >
              Auto-Accept
            </label>
            <button
              id="autoAcceptToggle"
              type="button"
              onClick={toggleAutoAccept}
              style={{
                width: '50px',
                height: '26px',
                borderRadius: '13px',
                border: 'none',
                cursor: 'pointer',
                position: 'relative',
                background: autoAccept
                  ? 'var(--success-color)'
                  : 'var(--border-color)',
                transition: 'background 0.2s',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: '3px',
                  left: autoAccept ? '27px' : '3px',
                  width: '20px',
                  height: '20px',
                  borderRadius: '50%',
                  background: 'white',
                  transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }}
              />
            </button>
            {processingAutoAccept && (
              <span
                style={{
                  fontSize: '0.875rem',
                  color: 'var(--secondary-color)',
                }}
              >
                Processing...
              </span>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <p>Loading scores...</p>
      ) : !selectedSpreadsheet ? (
        <p>Please select a sheet to view scores.</p>
      ) : scores.length === 0 ? (
        <p>No scores submitted for this sheet yet.</p>
      ) : selectedPurpose === 'bracket' ? (
        renderBracketTable()
      ) : (
        renderSeedingTable()
      )}

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
