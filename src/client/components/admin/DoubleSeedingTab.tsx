import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../Toast';
import { useConfirm } from '../ConfirmModal';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext';
import { teamsQueryOptions } from '../../queries/teams';
import {
  doubleSeedingMatchesQueryOptions,
  doubleSeedingRankingsQueryOptions,
  doubleSeedingScoresQueryOptions,
  useDoubleSeedingMutations,
} from '../../queries/doubleSeeding';
import QueryFeedback, { queryData } from '../QueryFeedback';
import type { Team } from '../../api/teams';
import type {
  DoubleSeedingMatch,
  DoubleSeedingRanking,
  DoubleSeedingScore,
} from '../../api/doubleSeeding';
import DoubleSeedingDisplay from '../doubleSeeding/DoubleSeedingDisplay';
import './SeedingTab.css';

const EMPTY_TEAMS: Team[] = [];
const EMPTY_SCORES: DoubleSeedingScore[] = [];
const EMPTY_RANKINGS: DoubleSeedingRanking[] = [];
const EMPTY_MATCHES: DoubleSeedingMatch[] = [];

function formatMatchTeam(
  teamId: number | null,
  teamNumber: number | null,
  teamName: string | null,
): string {
  if (teamId == null) return 'Solo run';
  const name = teamName ?? '';
  return teamNumber != null ? `#${teamNumber} ${name}`.trim() : name;
}

export default function DoubleSeedingTab() {
  const { selectedEvent } = useEvent();
  const { user, loading: authLoading } = useAuth();
  const { generate, removeRound, recalculate } = useDoubleSeedingMutations();
  const selectedEventId = selectedEvent?.id ?? null;
  const configuredRounds = selectedEvent?.double_seeding_rounds ?? 0;
  const userId = user?.id ?? 0;
  const [roundsInput, setRoundsInput] = useState<number>(configuredRounds);
  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();
  const enabled = Boolean(user && !authLoading && selectedEventId);
  const teamsQuery = useQuery({
    ...teamsQueryOptions(userId, selectedEventId ?? 0),
    enabled,
  });
  const scoresQuery = useQuery({
    ...doubleSeedingScoresQueryOptions(userId, selectedEventId ?? 0),
    enabled,
  });
  const rankingsQuery = useQuery({
    ...doubleSeedingRankingsQueryOptions(userId, selectedEventId ?? 0),
    enabled,
  });
  const matchesQuery = useQuery({
    ...doubleSeedingMatchesQueryOptions(userId, selectedEventId ?? 0),
    enabled,
  });
  const teams = queryData(teamsQuery) ?? EMPTY_TEAMS;
  const scores = queryData(scoresQuery) ?? EMPTY_SCORES;
  const rankings = queryData(rankingsQuery) ?? EMPTY_RANKINGS;
  const matches = queryData(matchesQuery) ?? EMPTY_MATCHES;
  const loading =
    teamsQuery.isLoading ||
    scoresQuery.isLoading ||
    rankingsQuery.isLoading ||
    matchesQuery.isLoading;
  const errorQuery = [
    teamsQuery,
    scoresQuery,
    rankingsQuery,
    matchesQuery,
  ].find((query) => query.isError);

  const effectiveRounds = useMemo(() => {
    if (configuredRounds > 0) return configuredRounds;
    return matches.reduce((max, match) => Math.max(max, match.round_number), 0);
  }, [configuredRounds, matches]);

  const matchesByRound = useMemo(() => {
    const byRound = new Map<number, DoubleSeedingMatch[]>();
    for (const match of matches) {
      const list = byRound.get(match.round_number) ?? [];
      list.push(match);
      byRound.set(match.round_number, list);
    }
    return Array.from(byRound.entries()).sort((a, b) => a[0] - b[0]);
  }, [matches]);

  useEffect(() => {
    setRoundsInput(configuredRounds);
  }, [configuredRounds]);

  const handleGenerate = async () => {
    if (!selectedEventId || !user) return;

    if (roundsInput > teams.length) {
      toast.error('Double-seeding rounds cannot exceed the number of teams');
      return;
    }

    if (roundsInput > 0 && teams.length === 0) {
      toast.error('Add teams before enabling double seeding');
      return;
    }

    if (
      roundsInput > 0 &&
      matches.length > 0 &&
      roundsInput < effectiveRounds
    ) {
      toast.error('Use Remove Last Round to reduce double-seeding rounds');
      return;
    }

    if (roundsInput === 0 && matches.length > 0) {
      const confirmed = await confirm({
        title: 'Disable Double Seeding',
        message:
          'This will delete all unsubmitted double-seeding matches and set double-seeding rounds to 0. This cannot be undone.\n\nAre you sure?',
        confirmText: 'Disable',
        confirmStyle: 'danger',
      });
      if (!confirmed) return;
    }

    try {
      const data = await generate.mutateAsync({
        userId: user.id,
        eventId: selectedEventId,
        rounds: roundsInput,
      });
      toast.success(
        data.message ||
          `Updated double seeding to ${data.rounds} round${data.rounds === 1 ? '' : 's'}`,
      );
      setRoundsInput(data.rounds);
    } catch (error: unknown) {
      toast.error((error as Error).message || 'Failed to generate matches');
    }
  };

  const handleDeleteRound = async (round: number) => {
    if (!selectedEventId || !user) return;
    const confirmed = await confirm({
      title: `Remove Round ${round}`,
      message: `This will delete round ${round} if no double-seeding submissions or accepted scores exist for that round. This cannot be undone.\n\nAre you sure?`,
      confirmText: 'Remove Round',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;

    try {
      const data = await removeRound.mutateAsync({
        userId: user.id,
        eventId: selectedEventId,
        round,
      });
      toast.success(`Removed round ${data.round}`);
      setRoundsInput(data.remainingRounds);
    } catch (error: unknown) {
      toast.error((error as Error).message || 'Failed to remove round');
    }
  };

  const handleRecalculate = async () => {
    if (!selectedEventId || !user) return;
    try {
      const data = await recalculate.mutateAsync({
        userId: user.id,
        eventId: selectedEventId,
      });
      toast.success(
        `Rankings recalculated (${data.teamsRanked} ranked, ${data.teamsUnranked} unranked)`,
      );
    } catch (error: unknown) {
      toast.error((error as Error).message || 'Failed to recalculate');
    }
  };

  const getMatchStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <span className="badge badge-success">Completed</span>;
      case 'ready':
        return <span className="badge badge-info">Ready</span>;
      case 'in_progress':
        return <span className="badge badge-warning">In Progress</span>;
      default:
        return <span className="badge badge-secondary">{status}</span>;
    }
  };

  if (!selectedEventId) {
    return (
      <div className="seeding-tab">
        <div className="card">
          <p style={{ color: 'var(--secondary-color)' }}>
            Please select an event from the dropdown above to manage double
            seeding.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="seeding-tab">
      <h2>Double Seeding</h2>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <h3 style={{ marginTop: 0 }}>Match Generation</h3>
        <p style={{ color: 'var(--secondary-color)', fontSize: '0.9rem' }}>
          Teams are randomly paired once per round. Each team plays every round;
          with an odd team count one team runs alone each round. Each team only
          receives the score from its own side of the table. Set rounds to 0 to
          disable double seeding; increasing the value adds rounds without
          changing existing matches.
        </p>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: '1rem',
            flexWrap: 'wrap',
          }}
        >
          <div>
            <label htmlFor="double-seeding-rounds">Rounds</label>
            <input
              id="double-seeding-rounds"
              type="number"
              className="field-input"
              min={0}
              max={Math.max(teams.length, 0)}
              value={roundsInput}
              onChange={(e) =>
                setRoundsInput(
                  Math.min(
                    Math.max(0, parseInt(e.target.value, 10) || 0),
                    Math.max(teams.length, 0),
                  ),
                )
              }
              style={{ width: '90px' }}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={() => void handleGenerate()}
            disabled={
              generate.isPending ||
              (roundsInput > 0 && teams.length === 0) ||
              (matches.length === 0 && roundsInput === 0) ||
              (matches.length > 0 && roundsInput === effectiveRounds)
            }
          >
            {generate.isPending
              ? 'Updating...'
              : roundsInput === 0
                ? matches.length > 0
                  ? 'Disable Double Seeding'
                  : 'Double Seeding Disabled'
                : matches.length > 0
                  ? roundsInput > effectiveRounds
                    ? 'Add Rounds'
                    : 'Update Rounds'
                  : 'Generate Matches'}
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => void handleRecalculate()}
            disabled={effectiveRounds === 0 || recalculate.isPending}
          >
            Recalculate Rankings
          </button>
        </div>
        {teams.length === 0 && (
          <p style={{ color: 'var(--secondary-color)', marginTop: '0.5rem' }}>
            Add teams in the Teams tab before generating matches.
          </p>
        )}
      </div>

      {errorQuery ? <QueryFeedback query={errorQuery} /> : null}
      {loading ? (
        <p>Loading double-seeding data...</p>
      ) : (
        <>
          {effectiveRounds > 0 ? (
            <DoubleSeedingDisplay
              teams={teams}
              scores={scores}
              rankings={rankings}
              effectiveRounds={effectiveRounds}
            />
          ) : (
            <div className="card">
              <p style={{ color: 'var(--secondary-color)', margin: 0 }}>
                Double seeding is disabled for this event.
              </p>
            </div>
          )}

          {matches.length > 0 && (
            <div className="card" style={{ marginTop: '1rem' }}>
              <h3 style={{ marginTop: 0 }}>Matches by Round</h3>
              {matchesByRound.map(([round, roundMatches]) => (
                <div key={round} style={{ marginBottom: '1rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '1rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <h4 style={{ margin: '0.5rem 0' }}>Round {round}</h4>
                    {round === effectiveRounds && (
                      <button
                        className="btn btn-danger"
                        onClick={() => void handleDeleteRound(round)}
                        disabled={
                          removeRound.isPending &&
                          removeRound.variables?.round === round
                        }
                      >
                        {removeRound.isPending &&
                        removeRound.variables?.round === round
                          ? 'Removing...'
                          : 'Remove Last Round'}
                      </button>
                    )}
                  </div>
                  <div className="table-responsive">
                    <table className="seeding-table">
                      <thead>
                        <tr>
                          <th>Match</th>
                          <th>Team 1 (Side A)</th>
                          <th>Team 2 (Side B)</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {roundMatches.map((match) => (
                          <tr key={match.id}>
                            <td>{match.match_number ?? '—'}</td>
                            <td>
                              {formatMatchTeam(
                                match.team1_id,
                                match.team1_number,
                                match.team1_name,
                              )}
                            </td>
                            <td>
                              {formatMatchTeam(
                                match.team2_id,
                                match.team2_number,
                                match.team2_name,
                              )}
                            </td>
                            <td>{getMatchStatusBadge(match.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
