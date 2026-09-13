import { useState, useMemo, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UnifiedTable } from '../table';
import type { UnifiedColumnDef } from '../table';
import { useSearchParams } from 'react-router-dom';
import ScoreViewModal from './ScoreViewModal';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext';
import { formatDateTime } from '../../utils/dateUtils';
import {
  isScoreAcceptConflict,
  scoreAcceptConflictFrom,
  type AffectedGame,
  type ScoreSubmission,
} from '../../api/scores';
import { scoresQueryOptions, useScoreMutations } from '../../queries/scores';
import QueryFeedback, { queryData } from '../QueryFeedback';
import '../Modal.css';
import './ScoringTab.css';

const EMPTY_SCORES: ScoreSubmission[] = [];
const EVENT_LIMIT = 50;

export default function ScoringTab() {
  const { selectedEvent } = useEvent();
  const { user, loading: authLoading } = useAuth();
  const selectedEventId = selectedEvent?.id ?? null;
  const userId = user?.id ?? 0;
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
          if (next <= 1) {
            p.delete('page');
          } else {
            p.set('page', String(next));
          }
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
  const [bulkAcceptSelected, setBulkAcceptSelected] = useState<Set<number>>(
    new Set(),
  );

  const enabled = Boolean(user && !authLoading && selectedEventId);
  const scoresQuery = useQuery({
    ...scoresQueryOptions(userId, selectedEventId ?? 0, {
      page: eventPage,
      limit: EVENT_LIMIT,
      status: eventFilterStatus,
      scoreType: eventFilterType,
    }),
    enabled,
  });
  const scorePage = queryData(scoresQuery);
  const scores = scorePage?.rows ?? EMPTY_SCORES;
  const eventTotalPages = scorePage?.totalPages ?? 1;
  const eventTotalCount = scorePage?.totalCount ?? 0;
  const loading = scoresQuery.isLoading && scorePage === undefined;
  const pendingScores = useMemo(
    () => scores.filter((s) => s.status === 'pending'),
    [scores],
  );
  const { accept, previewRevert, revert, reject, bulkAccept } =
    useScoreMutations();

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();
  const fail = (fallback: string, error: unknown) =>
    toast.error(error instanceof Error ? error.message : fallback);

  const scoreScope = () => ({
    userId,
    eventId: selectedEventId ?? 0,
  });

  const handleAcceptEvent = async (id: number, force = false) => {
    try {
      const data = await accept.mutateAsync({
        ...scoreScope(),
        scoreId: id,
        force,
      });
      if (data.advanced) {
        toast.success(
          `Score accepted. Winner advanced to game ${data.advancedTo || 'next round'}.`,
        );
      } else {
        toast.success('Score accepted successfully');
      }
    } catch (error) {
      if (isScoreAcceptConflict(error) && !force) {
        const data = scoreAcceptConflictFrom(error);
        const existingDescription = data.existingResultType
          ? `${data.existingResultType} (winner ${data.existingWinnerId})`
          : (data.existingScore ?? data.existingWinnerId);
        const newDescription = data.newResultType
          ? `${data.newResultType} (winner ${data.newWinnerId})`
          : (data.newScore ?? data.newWinnerId);
        const confirmed = await confirm({
          title: 'Score Conflict',
          message: `A score already exists for this entry.\n\nExisting: ${existingDescription}\nNew: ${newDescription}\n\nDo you want to override?`,
          confirmText: 'Override',
          confirmStyle: 'warning',
        });
        if (confirmed) return handleAcceptEvent(id, true);
        return;
      }
      fail('Failed to accept score', error);
    }
  };

  const handleRevertEvent = async (id: number) => {
    try {
      const dryRunData = await previewRevert.mutateAsync({
        ...scoreScope(),
        scoreId: id,
      });
      if (dryRunData.requiresConfirmation) {
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
      } else {
        const confirmed = await confirm({
          title: 'Revert Score',
          message: 'Are you sure you want to revert this score to pending?',
          confirmText: 'Revert',
          confirmStyle: 'warning',
        });
        if (!confirmed) return;
      }
      const data = await revert.mutateAsync({ ...scoreScope(), scoreId: id });
      if (data.revertedGames && data.revertedGames > 1) {
        toast.success(`Score reverted. ${data.revertedGames} games affected.`);
      } else {
        toast.success('Score reverted successfully');
      }
    } catch (error) {
      fail('Failed to revert score', error);
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
      await reject.mutateAsync({ ...scoreScope(), scoreId: id });
    } catch (error) {
      fail('Failed to reject score', error);
    }
  };

  const handleEdit = (score: ScoreSubmission) => {
    setEditingScore(score);
  };

  const handleOpenBulkAccept = () => {
    setBulkAcceptSelected(new Set(pendingScores.map((s) => s.id)));
    setShowBulkAccept(true);
  };

  const handleCloseBulkAccept = () => {
    setShowBulkAccept(false);
    setBulkAcceptSelected(new Set());
  };

  const handleToggleBulkAcceptScore = (id: number) => {
    setBulkAcceptSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAllBulkAccept = () => {
    setBulkAcceptSelected(new Set(pendingScores.map((s) => s.id)));
  };

  const handleSelectNoneBulkAccept = () => {
    setBulkAcceptSelected(new Set());
  };

  const handleBulkAccept = async () => {
    if (bulkAcceptSelected.size === 0 || !selectedEventId) return;
    try {
      const data = await bulkAccept.mutateAsync({
        ...scoreScope(),
        scoreIds: Array.from(bulkAcceptSelected),
      });
      toast.success(`Accepted ${data.accepted} score(s)`);
      if (data.skipped && data.skipped.length > 0) {
        toast.warning(`${data.skipped.length} score(s) skipped (conflicts)`);
      }
      handleCloseBulkAccept();
    } catch (error) {
      fail('Failed to accept scores', error);
    }
  };

  const handleScoreUpdated = () => {
    setEditingScore(null);
  };

  const getSeedingRowDisplay = (score: ScoreSubmission) => {
    const data = score.score_data || {};
    const teamNum =
      score.team_display_number ||
      data.team_number?.value ||
      data.team_a_number?.value ||
      '-';
    const teamName =
      score.team_name || data.team_name?.value || data.team_a_name?.value || '';
    const round = score.seeding_round || data.round?.value;
    const roundLabel = round ? `Round ${round}` : '-';
    const total =
      data.grand_total?.value ??
      data.team_a_total?.value ??
      data.score?.value ??
      '-';
    return { teamNum, teamName, roundLabel, total };
  };

  const getBracketRowDisplay = (score: ScoreSubmission) => {
    const data = score.score_data || {};

    const team1Label =
      score.bracket_team1_display ||
      score.bracket_team1_name ||
      (score.bracket_team1_number != null
        ? String(score.bracket_team1_number)
        : null) ||
      data.team_a_name?.value ||
      data.team_a_number?.value ||
      'TBD';
    const team2Label =
      score.bracket_team2_display ||
      score.bracket_team2_name ||
      (score.bracket_team2_number != null
        ? String(score.bracket_team2_number)
        : null) ||
      data.team_b_name?.value ||
      data.team_b_number?.value ||
      'TBD';

    const bracketName = score.bracket_name || 'Bracket';
    const gameNum = score.game_number || data.game_number?.value;
    const gameLabel = gameNum ? `Game ${gameNum}` : '-';

    const team1Score =
      data.team1_score?.value ?? score.bracket_team1_score ?? null;
    const team2Score =
      data.team2_score?.value ?? score.bracket_team2_score ?? null;
    let scoreLabel: string;
    if (score.result_type === 'no_contest') {
      scoreLabel = 'No contest';
    } else if (score.result_type === 'disqualification') {
      const disqualifiedLabel =
        score.disqualified_team_id === score.bracket_team1_id
          ? team1Label
          : score.disqualified_team_id === score.bracket_team2_id
            ? team2Label
            : 'Unknown team';
      scoreLabel = `DQ — ${disqualifiedLabel}`;
    } else {
      scoreLabel =
        team1Score != null && team2Score != null
          ? `${team1Score} – ${team2Score}`
          : '-';
    }

    let winnerLabel =
      score.bracket_winner_display ||
      score.bracket_winner_name ||
      (score.bracket_winner_number != null
        ? String(score.bracket_winner_number)
        : null) ||
      data.winner_name?.value ||
      null;

    if (!winnerLabel) {
      const winnerId =
        data.winner_team_id?.value ?? data.winner_id?.value ?? null;
      if (winnerId != null) {
        if (winnerId === score.bracket_team1_id) {
          winnerLabel = team1Label;
        } else if (winnerId === score.bracket_team2_id) {
          winnerLabel = team2Label;
        } else {
          winnerLabel = `Team ${winnerId}`;
        }
      } else {
        winnerLabel = '-';
      }
    }

    return {
      team1Label,
      team2Label,
      bracketName,
      gameLabel,
      scoreLabel,
      winnerLabel,
    };
  };

  const getDoubleSeedingRowDisplay = (score: ScoreSubmission) => {
    const data = score.score_data || {};

    const team1Label =
      score.double_seeding_team1_display ||
      score.double_seeding_team1_name ||
      (score.double_seeding_team1_number != null
        ? String(score.double_seeding_team1_number)
        : null) ||
      data.team_a_name?.value ||
      data.team_a_number?.value ||
      'TBD';
    const hasTeam2 =
      score.double_seeding_team2_id != null ||
      data.team_b_id?.value != null ||
      (data.team_b_number?.value && data.team_b_number.value !== 'None');
    const team2Label = hasTeam2
      ? score.double_seeding_team2_display ||
        score.double_seeding_team2_name ||
        (score.double_seeding_team2_number != null
          ? String(score.double_seeding_team2_number)
          : null) ||
        data.team_b_name?.value ||
        data.team_b_number?.value ||
        'TBD'
      : 'Solo run';

    const round = score.double_seeding_round ?? data.round?.value;
    const roundLabel = round ? `Round ${round}` : '-';
    const matchNum =
      score.double_seeding_match_number ?? data.match_number?.value;
    const matchLabel = matchNum != null ? `Match ${matchNum}` : '-';

    const teamATotal = data.team_a_total?.value ?? null;
    const teamBTotal = data.team_b_total?.value ?? null;
    const scoreLabel = hasTeam2
      ? teamATotal != null || teamBTotal != null
        ? `${teamATotal ?? '-'} – ${teamBTotal ?? '-'}`
        : '-'
      : teamATotal != null
        ? String(teamATotal)
        : '-';

    return { team1Label, team2Label, roundLabel, matchLabel, scoreLabel };
  };

  const getStatusBadge = (score: ScoreSubmission) => {
    const { status, reviewed_by } = score;
    switch (status) {
      case 'accepted':
        return reviewed_by == null ? (
          <span
            className="badge badge-success"
            title="Auto-accepted by the system"
          >
            Automatically Accepted
          </span>
        ) : (
          <span className="badge badge-success">Accepted</span>
        );
      case 'rejected':
        return <span className="badge badge-danger">Rejected</span>;
      default:
        return <span className="badge badge-warning">Pending</span>;
    }
  };

  const seedingScores = useMemo(
    () => scores.filter((s) => s.score_type === 'seeding'),
    [scores],
  );
  const bracketScores = useMemo(
    () => scores.filter((s) => s.score_type === 'bracket'),
    [scores],
  );
  const doubleSeedingScores = useMemo(
    () => scores.filter((s) => s.score_type === 'double_seeding'),
    [scores],
  );

  const buildSeedingColumns = (
    showType: boolean,
  ): UnifiedColumnDef<ScoreSubmission>[] => {
    const cols: UnifiedColumnDef<ScoreSubmission>[] = [];
    if (showType) {
      cols.push({
        kind: 'data',
        id: 'type',
        header: { full: 'Type' },
        renderCell: () => <span className="badge badge-info">Seeding</span>,
      });
    }
    cols.push(
      {
        kind: 'data',
        id: 'team',
        header: { full: 'Team' },
        renderCell: (score) => {
          const { teamNum, teamName } = getSeedingRowDisplay(score);
          return (
            <>
              <div>
                <strong>{teamNum}</strong>
              </div>
              {teamName && (
                <small style={{ color: 'var(--text-secondary)' }}>
                  {teamName}
                </small>
              )}
            </>
          );
        },
      },
      {
        kind: 'data',
        id: 'round',
        header: { full: 'Round' },
        renderCell: (score) => getSeedingRowDisplay(score).roundLabel,
      },
      {
        kind: 'data',
        id: 'total',
        header: { full: 'Total' },
        renderCell: (score) => (
          <strong style={{ color: 'var(--primary-color)' }}>
            {getSeedingRowDisplay(score).total}
          </strong>
        ),
      },
      {
        kind: 'data',
        id: 'submitted',
        header: { full: 'Submitted' },
        renderCell: (score) => formatDateTime(score.created_at),
      },
      {
        kind: 'data',
        id: 'status',
        header: { full: 'Status' },
        renderCell: (score) => getStatusBadge(score),
      },
      {
        kind: 'data',
        id: 'reviewed',
        header: { full: 'Reviewed' },
        renderCell: (score) => (
          <>
            {score.reviewer_name || '-'}
            {score.reviewed_at && (
              <>
                <br />
                <small>{formatDateTime(score.reviewed_at)}</small>
              </>
            )}
          </>
        ),
      },
      {
        kind: 'data',
        id: 'actions',
        header: { full: 'Actions' },
        renderCell: (score) => renderEventActions(score),
      },
    );
    return cols;
  };

  const buildBracketColumns = (
    showType: boolean,
  ): UnifiedColumnDef<ScoreSubmission>[] => {
    const cols: UnifiedColumnDef<ScoreSubmission>[] = [];
    if (showType) {
      cols.push({
        kind: 'data',
        id: 'type',
        header: { full: 'Type' },
        renderCell: () => <span className="badge badge-purple">Bracket</span>,
      });
    }
    cols.push(
      {
        kind: 'data',
        id: 'matchup',
        header: { full: 'Matchup' },
        renderCell: (score) => {
          const { team1Label, team2Label } = getBracketRowDisplay(score);
          return (
            <div className="bracket-matchup-cell">
              <span>{team1Label}</span>
              <span className="bracket-vs">vs</span>
              <span>{team2Label}</span>
            </div>
          );
        },
      },
      {
        kind: 'data',
        id: 'game',
        header: { full: 'Game' },
        renderCell: (score) => getBracketRowDisplay(score).gameLabel,
      },
      {
        kind: 'data',
        id: 'score',
        header: { full: 'Score' },
        renderCell: (score) => (
          <strong style={{ color: 'var(--primary-color)' }}>
            {getBracketRowDisplay(score).scoreLabel}
          </strong>
        ),
      },
      {
        kind: 'data',
        id: 'winner',
        header: { full: 'Winner' },
        renderCell: (score) => (
          <span className="bracket-winner-cell">
            {getBracketRowDisplay(score).winnerLabel}
          </span>
        ),
      },
      {
        kind: 'data',
        id: 'submitted',
        header: { full: 'Submitted' },
        renderCell: (score) => formatDateTime(score.created_at),
      },
      {
        kind: 'data',
        id: 'status',
        header: { full: 'Status' },
        renderCell: (score) => getStatusBadge(score),
      },
      {
        kind: 'data',
        id: 'reviewed',
        header: { full: 'Reviewed' },
        renderCell: (score) => (
          <>
            {score.reviewer_name || '-'}
            {score.reviewed_at && (
              <>
                <br />
                <small>{formatDateTime(score.reviewed_at)}</small>
              </>
            )}
          </>
        ),
      },
      {
        kind: 'data',
        id: 'actions',
        header: { full: 'Actions' },
        renderCell: (score) => renderEventActions(score),
      },
    );
    return cols;
  };

  const buildDoubleSeedingColumns = (
    showType: boolean,
  ): UnifiedColumnDef<ScoreSubmission>[] => {
    const cols: UnifiedColumnDef<ScoreSubmission>[] = [];
    if (showType) {
      cols.push({
        kind: 'data',
        id: 'type',
        header: { full: 'Type' },
        renderCell: () => (
          <span className="badge badge-info">Double Seeding</span>
        ),
      });
    }
    cols.push(
      {
        kind: 'data',
        id: 'matchup',
        header: { full: 'Matchup' },
        renderCell: (score) => {
          const { team1Label, team2Label } = getDoubleSeedingRowDisplay(score);
          return (
            <div className="bracket-matchup-cell">
              <span>{team1Label}</span>
              <span className="bracket-vs">vs</span>
              <span>{team2Label}</span>
            </div>
          );
        },
      },
      {
        kind: 'data',
        id: 'round',
        header: { full: 'Round' },
        renderCell: (score) => getDoubleSeedingRowDisplay(score).roundLabel,
      },
      {
        kind: 'data',
        id: 'match',
        header: { full: 'Match' },
        renderCell: (score) => getDoubleSeedingRowDisplay(score).matchLabel,
      },
      {
        kind: 'data',
        id: 'score',
        header: { full: 'Score' },
        renderCell: (score) => (
          <strong style={{ color: 'var(--primary-color)' }}>
            {getDoubleSeedingRowDisplay(score).scoreLabel}
          </strong>
        ),
      },
      {
        kind: 'data',
        id: 'submitted',
        header: { full: 'Submitted' },
        renderCell: (score) => formatDateTime(score.created_at),
      },
      {
        kind: 'data',
        id: 'status',
        header: { full: 'Status' },
        renderCell: (score) => getStatusBadge(score),
      },
      {
        kind: 'data',
        id: 'reviewed',
        header: { full: 'Reviewed' },
        renderCell: (score) => (
          <>
            {score.reviewer_name || '-'}
            {score.reviewed_at && (
              <>
                <br />
                <small>{formatDateTime(score.reviewed_at)}</small>
              </>
            )}
          </>
        ),
      },
      {
        kind: 'data',
        id: 'actions',
        header: { full: 'Actions' },
        renderCell: (score) => renderEventActions(score),
      },
    );
    return cols;
  };

  const renderSeedingTable = (rows: ScoreSubmission[], showType: boolean) => (
    <UnifiedTable
      columns={buildSeedingColumns(showType)}
      rows={rows}
      getRowKey={(s) => s.id}
      headerLabelVariant="none"
    />
  );

  const renderBracketTable = (rows: ScoreSubmission[], showType: boolean) => (
    <UnifiedTable
      columns={buildBracketColumns(showType)}
      rows={rows}
      getRowKey={(s) => s.id}
      headerLabelVariant="none"
    />
  );

  const renderDoubleSeedingTable = (
    rows: ScoreSubmission[],
    showType: boolean,
  ) => (
    <UnifiedTable
      columns={buildDoubleSeedingColumns(showType)}
      rows={rows}
      getRowKey={(s) => s.id}
      headerLabelVariant="none"
    />
  );

  const renderEventTables = () => {
    if (eventFilterType === 'seeding') {
      return renderSeedingTable(scores, false);
    }
    if (eventFilterType === 'bracket') {
      return renderBracketTable(scores, false);
    }
    if (eventFilterType === 'double_seeding') {
      return renderDoubleSeedingTable(scores, false);
    }
    // "All" — show stacked sections so columns stay stable
    return (
      <>
        {seedingScores.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ margin: '0.5rem 0' }}>Seeding Scores</h4>
            {renderSeedingTable(seedingScores, false)}
          </div>
        )}
        {bracketScores.length > 0 && (
          <div style={{ marginBottom: '1.5rem' }}>
            <h4 style={{ margin: '0.5rem 0' }}>Bracket Scores</h4>
            {renderBracketTable(bracketScores, false)}
          </div>
        )}
        {doubleSeedingScores.length > 0 && (
          <div>
            <h4 style={{ margin: '0.5rem 0' }}>Double Seeding Scores</h4>
            {renderDoubleSeedingTable(doubleSeedingScores, false)}
          </div>
        )}
      </>
    );
  };

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
            disabled={
              accept.isPending && accept.variables?.scoreId === score.id
            }
            style={{ fontSize: '0.85rem', padding: '0.4rem 0.6rem' }}
          >
            Accept
          </button>
          <button
            className="btn btn-danger"
            onClick={() => handleReject(score.id)}
            disabled={
              reject.isPending && reject.variables?.scoreId === score.id
            }
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
            disabled={
              (previewRevert.isPending || revert.isPending) &&
              (previewRevert.variables?.scoreId === score.id ||
                revert.variables?.scoreId === score.id)
            }
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
              <option value="double_seeding">Double Seeding</option>
            </select>
          </div>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
            <button
              className="btn btn-success"
              onClick={handleOpenBulkAccept}
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
              onClick={() => void scoresQuery.refetch()}
              style={{ padding: '0.5rem 1rem' }}
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Event Content */}
      <>
        {scoresQuery.isError ? <QueryFeedback query={scoresQuery} /> : null}
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
      </>

      {editingScore && (
        <ScoreViewModal
          score={editingScore}
          onClose={() => setEditingScore(null)}
          onSave={handleScoreUpdated}
        />
      )}

      {/* Bulk Accept Modal */}
      {showBulkAccept && (
        <div className="modal show" onClick={handleCloseBulkAccept}>
          <div
            className="modal-content"
            style={{ maxWidth: '600px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <span className="close" onClick={handleCloseBulkAccept}>
              &times;
            </span>
            <h3>Bulk Accept Scores</h3>
            <p
              style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}
            >
              Select the pending scores you want to accept. All scores are
              selected by default.
            </p>

            <div
              style={{
                display: 'flex',
                gap: '0.5rem',
                marginBottom: '1rem',
              }}
            >
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleSelectAllBulkAccept}
                style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
              >
                Select All
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleSelectNoneBulkAccept}
                style={{ fontSize: '0.8rem', padding: '0.25rem 0.5rem' }}
              >
                Select None
              </button>
              <span
                style={{
                  marginLeft: 'auto',
                  color: 'var(--secondary-color)',
                  fontSize: '0.875rem',
                  alignSelf: 'center',
                }}
              >
                {bulkAcceptSelected.size} of {pendingScores.length} selected
              </span>
            </div>

            <div className="bulk-accept-list">
              {pendingScores.length === 0 ? (
                <p style={{ color: 'var(--secondary-color)' }}>
                  No pending scores in the current view. Filter by status
                  &quot;Pending&quot; to see scores to accept.
                </p>
              ) : (
                pendingScores.map((score) => {
                  const scoreType = score.score_type || 'unknown';

                  if (scoreType === 'bracket') {
                    const {
                      team1Label,
                      team2Label,
                      gameLabel,
                      scoreLabel,
                      winnerLabel,
                    } = getBracketRowDisplay(score);
                    return (
                      <label key={score.id} className="bulk-accept-item">
                        <input
                          type="checkbox"
                          checked={bulkAcceptSelected.has(score.id)}
                          onChange={() => handleToggleBulkAcceptScore(score.id)}
                        />
                        <span className="bulk-accept-context">{gameLabel}</span>
                        <span className="bulk-accept-detail">
                          {team1Label} vs {team2Label} — {scoreLabel} →{' '}
                          {winnerLabel}
                        </span>
                      </label>
                    );
                  }

                  if (scoreType === 'double_seeding') {
                    const { team1Label, team2Label, roundLabel, scoreLabel } =
                      getDoubleSeedingRowDisplay(score);
                    return (
                      <label key={score.id} className="bulk-accept-item">
                        <input
                          type="checkbox"
                          checked={bulkAcceptSelected.has(score.id)}
                          onChange={() => handleToggleBulkAcceptScore(score.id)}
                        />
                        <span className="bulk-accept-context">
                          {roundLabel}
                        </span>
                        <span className="bulk-accept-detail">
                          {team1Label} vs {team2Label} — {scoreLabel}
                        </span>
                      </label>
                    );
                  }

                  const { teamNum, roundLabel, total } =
                    getSeedingRowDisplay(score);
                  return (
                    <label key={score.id} className="bulk-accept-item">
                      <input
                        type="checkbox"
                        checked={bulkAcceptSelected.has(score.id)}
                        onChange={() => handleToggleBulkAcceptScore(score.id)}
                      />
                      <span className="bulk-accept-context">{roundLabel}</span>
                      <span className="bulk-accept-detail">
                        Team {teamNum} — {total}
                      </span>
                    </label>
                  );
                })
              )}
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
                onClick={handleCloseBulkAccept}
                disabled={bulkAccept.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-success"
                onClick={handleBulkAccept}
                disabled={bulkAccept.isPending || bulkAcceptSelected.size === 0}
              >
                {bulkAccept.isPending
                  ? 'Accepting...'
                  : `Accept ${bulkAcceptSelected.size} Score(s)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
