import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import './SeedingTab.css';

interface Team {
  id: number;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

interface SeedingScore {
  id: number;
  team_id: number;
  round_number: number;
  score: number | null;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

interface SeedingRanking {
  id: number;
  team_id: number;
  seed_average: number | null;
  seed_rank: number | null;
  raw_seed_score: number | null;
  tiebreaker_value: number | null;
  team_number: number;
  team_name: string;
  display_name: string | null;
}

interface TeamRowData {
  team: Team;
  scores: Map<number, SeedingScore | null>; // round_number -> score record
  ranking: SeedingRanking | null;
}

export default function SeedingTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;
  const seedingRounds = selectedEvent?.seeding_rounds ?? 3;
  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<SeedingScore[]>([]);
  const [rankings, setRankings] = useState<SeedingRanking[]>([]);
  const [loading, setLoading] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  // Sorting state for Seeding Scores table
  type SortField = 'team_number' | 'team_name';
  type SortDirection = 'asc' | 'desc';
  const [sortField, setSortField] = useState<SortField>('team_number');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Debounce recalculation after saves
  const recalcTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const toast = useToast();

  // Determine effective number of rounds (fallback to 3)
  const effectiveRounds = seedingRounds > 0 ? seedingRounds : 3;

  // Load all data for the selected event
  const loadData = useCallback(async () => {
    if (!selectedEventId) {
      setTeams([]);
      setScores([]);
      setRankings([]);
      return;
    }

    setLoading(true);
    try {
      const [teamsRes, scoresRes, rankingsRes] = await Promise.all([
        fetch(`/teams/event/${selectedEventId}`, { credentials: 'include' }),
        fetch(`/seeding/scores/event/${selectedEventId}`, {
          credentials: 'include',
        }),
        fetch(`/seeding/rankings/event/${selectedEventId}`, {
          credentials: 'include',
        }),
      ]);

      if (!teamsRes.ok) throw new Error('Failed to fetch teams');
      if (!scoresRes.ok) throw new Error('Failed to fetch seeding scores');
      if (!rankingsRes.ok) throw new Error('Failed to fetch rankings');

      const teamsData: Team[] = await teamsRes.json();
      const scoresData: SeedingScore[] = await scoresRes.json();
      const rankingsData: SeedingRanking[] = await rankingsRes.json();

      setTeams(teamsData);
      setScores(scoresData);
      setRankings(rankingsData);
    } catch (error) {
      console.error('Error loading seeding data:', error);
      toast.error('Failed to load seeding data');
    } finally {
      setLoading(false);
    }
  }, [selectedEventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Build merged data for display
  const buildTeamRowData = useCallback((): TeamRowData[] => {
    const scoreMap = new Map<string, SeedingScore>();
    for (const score of scores) {
      scoreMap.set(`${score.team_id}:${score.round_number}`, score);
    }

    const rankingMap = new Map<number, SeedingRanking>();
    for (const ranking of rankings) {
      rankingMap.set(ranking.team_id, ranking);
    }

    return teams.map((team) => {
      const teamScores = new Map<number, SeedingScore | null>();
      for (let round = 1; round <= effectiveRounds; round++) {
        teamScores.set(round, scoreMap.get(`${team.id}:${round}`) || null);
      }
      return {
        team,
        scores: teamScores,
        ranking: rankingMap.get(team.id) || null,
      };
    });
  }, [teams, scores, rankings, effectiveRounds]);

  const teamRowData = buildTeamRowData();

  // Sort by selected field and direction
  const sortedTeamRowData = [...teamRowData].sort((a, b) => {
    let aVal: string | number;
    let bVal: string | number;

    if (sortField === 'team_number') {
      aVal = a.team.team_number;
      bVal = b.team.team_number;
    } else {
      aVal = a.team.team_name.toLowerCase();
      bVal = b.team.team_name.toLowerCase();
    }

    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
    return 0;
  });

  // Handle sort column click
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getSortIndicator = (field: SortField) => {
    if (sortField !== field) return null;
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  };

  // Recalculate rankings
  const recalculateRankings = async () => {
    if (!selectedEventId) return;

    setRecalculating(true);
    try {
      const response = await fetch(
        `/seeding/rankings/recalculate/${selectedEventId}`,
        {
          method: 'POST',
          credentials: 'include',
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to recalculate rankings');
      }

      const data = await response.json();
      setRankings(data.rankings);
    } catch (error) {
      console.error('Error recalculating rankings:', error);
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to recalculate rankings',
      );
    } finally {
      setRecalculating(false);
    }
  };

  // Manual recalculate button handler
  const handleRecalculateClick = async () => {
    // Clear any pending debounced recalc
    if (recalcTimeoutRef.current) {
      clearTimeout(recalcTimeoutRef.current);
      recalcTimeoutRef.current = null;
    }
    await recalculateRankings();
    toast.success('Rankings recalculated');
  };

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (recalcTimeoutRef.current) {
        clearTimeout(recalcTimeoutRef.current);
      }
    };
  }, []);

  if (!selectedEventId) {
    return (
      <div className="seeding-tab">
        <div className="card">
          <p style={{ color: 'var(--secondary-color)' }}>
            Please select an event from the dropdown above to manage seeding.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="seeding-tab">
      {loading ? (
        <p>Loading seeding data...</p>
      ) : teams.length === 0 ? (
        <div className="card">
          <p style={{ color: 'var(--secondary-color)' }}>
            No teams found for this event. Add teams in the Teams tab first.
          </p>
        </div>
      ) : (
        <>
          {/* Seeding Scores Table */}
          <div className="card seeding-section">
            <div className="seeding-section-header">
              <div>
                <h3>Seeding Scores</h3>
                <p className="seeding-section-description">
                  Seeding scores for each team and round.
                </p>
              </div>
            </div>
            <div className="table-responsive">
              <table className="seeding-table">
                <thead>
                  <tr>
                    <th
                      className="sortable"
                      onClick={() => handleSort('team_number')}
                    >
                      Team #{getSortIndicator('team_number')}
                    </th>
                    <th
                      className="sortable"
                      onClick={() => handleSort('team_name')}
                    >
                      Team Name{getSortIndicator('team_name')}
                    </th>
                    {Array.from({ length: effectiveRounds }, (_, i) => (
                      <th key={i + 1} className="score-col">
                        Round {i + 1}
                      </th>
                    ))}
                    <th className="avg-col">Seed Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTeamRowData.map((row) => (
                    <tr key={row.team.id}>
                      <td>{row.team.team_number}</td>
                      <td>{row.team.team_name}</td>
                      {Array.from({ length: effectiveRounds }, (_, i) => {
                        const round = i + 1;
                        const scoreRecord = row.scores.get(round) || null;
                        return (
                          <td key={round} className="score-cell">
                            {scoreRecord?.score ?? '—'}
                          </td>
                        );
                      })}
                      <td className="avg-cell">
                        {row.ranking?.seed_average !== null &&
                        row.ranking?.seed_average !== undefined
                          ? row.ranking.seed_average.toFixed(2)
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Rankings Table */}
          <div className="card seeding-section">
            <div className="seeding-section-header">
              <div>
                <h3>Rankings</h3>
                <p className="seeding-section-description">
                  Final rankings based on seed averages (top 2 of 3 scores). Raw
                  seed score uses official formula: 75% rank position + 25%
                  score ratio.
                </p>
              </div>
              <div className="seeding-actions">
                <button
                  className="btn btn-primary"
                  onClick={handleRecalculateClick}
                  disabled={recalculating || loading}
                >
                  {recalculating ? 'Calculating...' : 'Calculate Rankings'}
                </button>
                {recalculating && (
                  <span className="seeding-status">Updating rankings...</span>
                )}
              </div>
            </div>
            <div className="table-responsive">
              <table className="seeding-table rankings-table">
                <thead>
                  <tr>
                    <th>Seed Rank</th>
                    <th>Team #</th>
                    <th>Team Name</th>
                    <th>Seed Average</th>
                    <th>Raw Seed Score</th>
                    <th>Tiebreaker</th>
                  </tr>
                </thead>
                <tbody>
                  {rankings.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        style={{
                          textAlign: 'center',
                          color: 'var(--secondary-color)',
                        }}
                      >
                        No rankings calculated yet. Enter scores and click
                        "Calculate Rankings".
                      </td>
                    </tr>
                  ) : (
                    rankings
                      .sort((a, b) => {
                        const aRank = a.seed_rank ?? Infinity;
                        const bRank = b.seed_rank ?? Infinity;
                        return aRank - bRank;
                      })
                      .map((ranking) => (
                        <tr key={ranking.team_id}>
                          <td className="rank-cell">
                            {ranking.seed_rank ?? '—'}
                          </td>
                          <td>{ranking.team_number}</td>
                          <td>{ranking.team_name}</td>
                          <td>
                            {ranking.seed_average !== null
                              ? ranking.seed_average.toFixed(2)
                              : '—'}
                          </td>
                          <td>
                            {ranking.raw_seed_score !== null
                              ? ranking.raw_seed_score.toFixed(4)
                              : '—'}
                          </td>
                          <td>
                            {ranking.tiebreaker_value !== null
                              ? ranking.tiebreaker_value.toFixed(2)
                              : '—'}
                          </td>
                        </tr>
                      ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Summary */}
          <div className="seeding-summary">
            {teams.length} team{teams.length !== 1 ? 's' : ''} •{' '}
            {rankings.filter((r) => r.seed_rank !== null).length} ranked
          </div>
        </>
      )}

      {toast.ToastContainer}
    </div>
  );
}
