import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '../Toast';
import { useConfirm } from '../ConfirmModal';
import { useEvent } from '../../contexts/EventContext';
import type { Team } from '../seeding/SeedingScoresTable';
import type {
  DoubleSeedingScore,
  DoubleSeedingRanking,
} from '../doubleSeeding/DoubleSeedingScoresTable';
import DoubleSeedingDisplay from '../doubleSeeding/DoubleSeedingDisplay';
import './SeedingTab.css';

interface DoubleSeedingMatch {
  id: number;
  event_id: number;
  round_number: number;
  match_number: number | null;
  team1_id: number | null;
  team2_id: number | null;
  status: string;
  team1_number: number | null;
  team1_name: string | null;
  team1_display: string | null;
  team2_number: number | null;
  team2_name: string | null;
  team2_display: string | null;
}

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
  const { selectedEvent, refreshEvents } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;
  const configuredRounds = selectedEvent?.double_seeding_rounds ?? 0;

  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<DoubleSeedingScore[]>([]);
  const [rankings, setRankings] = useState<DoubleSeedingRanking[]>([]);
  const [matches, setMatches] = useState<DoubleSeedingMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [deletingRound, setDeletingRound] = useState<number | null>(null);
  const [roundsInput, setRoundsInput] = useState<number>(configuredRounds);

  const toast = useToast();
  const { confirm, ConfirmDialog } = useConfirm();

  const effectiveRounds = useMemo(() => {
    if (configuredRounds > 0) return configuredRounds;
    return matches.reduce((max, m) => Math.max(max, m.round_number), 0);
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

  const loadData = useCallback(async () => {
    if (!selectedEventId) {
      setTeams([]);
      setScores([]);
      setRankings([]);
      setMatches([]);
      return;
    }

    setLoading(true);
    try {
      const [teamsRes, scoresRes, rankingsRes, matchesRes] = await Promise.all([
        fetch(`/teams/event/${selectedEventId}`, { credentials: 'include' }),
        fetch(`/double-seeding/scores/event/${selectedEventId}`, {
          credentials: 'include',
        }),
        fetch(`/double-seeding/rankings/event/${selectedEventId}`, {
          credentials: 'include',
        }),
        fetch(`/double-seeding/matches/event/${selectedEventId}`, {
          credentials: 'include',
        }),
      ]);

      if (!teamsRes.ok) throw new Error('Failed to fetch teams');
      if (!scoresRes.ok)
        throw new Error('Failed to fetch double-seeding scores');
      if (!rankingsRes.ok) throw new Error('Failed to fetch rankings');
      if (!matchesRes.ok)
        throw new Error('Failed to fetch double-seeding matches');

      setTeams(await teamsRes.json());
      setScores(await scoresRes.json());
      setRankings(await rankingsRes.json());
      setMatches(await matchesRes.json());
    } catch (error) {
      console.error('Error loading double-seeding data:', error);
      toast.error('Failed to load double-seeding data');
    } finally {
      setLoading(false);
    }
  }, [selectedEventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setRoundsInput(configuredRounds);
  }, [configuredRounds]);

  const handleGenerate = async () => {
    if (!selectedEventId) return;

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

    setGenerating(true);
    try {
      const response = await fetch(
        `/double-seeding/matches/generate/${selectedEventId}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            rounds: roundsInput,
          }),
        },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to generate matches');
      }
      toast.success(
        data.message ||
          `Updated double seeding to ${data.rounds} round${data.rounds === 1 ? '' : 's'}`,
      );
      await loadData();
      refreshEvents();
    } catch (error: unknown) {
      console.error('Error generating double-seeding matches:', error);
      toast.error((error as Error).message || 'Failed to generate matches');
    } finally {
      setGenerating(false);
    }
  };

  const handleDeleteRound = async (round: number) => {
    if (!selectedEventId) return;
    const confirmed = await confirm({
      title: `Remove Round ${round}`,
      message: `This will delete round ${round} if no double-seeding submissions or accepted scores exist for that round. This cannot be undone.\n\nAre you sure?`,
      confirmText: 'Remove Round',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;

    setDeletingRound(round);
    try {
      const response = await fetch(
        `/double-seeding/matches/event/${selectedEventId}/round/${round}`,
        { method: 'DELETE', credentials: 'include' },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to remove round');
      }
      toast.success(`Removed round ${data.round}`);
      await loadData();
      refreshEvents();
    } catch (error: unknown) {
      console.error('Error removing double-seeding round:', error);
      toast.error((error as Error).message || 'Failed to remove round');
    } finally {
      setDeletingRound(null);
    }
  };

  const handleRecalculate = async () => {
    if (!selectedEventId) return;
    try {
      const response = await fetch(
        `/double-seeding/rankings/recalculate/${selectedEventId}`,
        { method: 'POST', credentials: 'include' },
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to recalculate rankings');
      }
      toast.success(
        `Rankings recalculated (${data.teamsRanked} ranked, ${data.teamsUnranked} unranked)`,
      );
      await loadData();
    } catch (error: unknown) {
      console.error('Error recalculating double-seeding rankings:', error);
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

      {/* Match generation controls */}
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
            onClick={handleGenerate}
            disabled={
              generating ||
              (roundsInput > 0 && teams.length === 0) ||
              (matches.length === 0 && roundsInput === 0) ||
              (matches.length > 0 && roundsInput === effectiveRounds)
            }
          >
            {generating
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
            onClick={handleRecalculate}
            disabled={effectiveRounds === 0}
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

          {/* Match list grouped by round */}
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
                        onClick={() => handleDeleteRound(round)}
                        disabled={deletingRound === round}
                      >
                        {deletingRound === round
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
