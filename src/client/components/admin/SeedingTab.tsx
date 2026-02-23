import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import SeedingScoresTable, {
  buildTeamRowData,
  Team,
  SeedingScore,
  SeedingRanking,
} from '../seeding/SeedingScoresTable';
import SeedingRankingsTable from '../seeding/SeedingRankingsTable';
import './SeedingTab.css';

export default function SeedingTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;
  const seedingRounds = selectedEvent?.seeding_rounds ?? 3;
  const [teams, setTeams] = useState<Team[]>([]);
  const [scores, setScores] = useState<SeedingScore[]>([]);
  const [rankings, setRankings] = useState<SeedingRanking[]>([]);
  const [loading, setLoading] = useState(false);

  const toast = useToast();

  const effectiveRounds = seedingRounds > 0 ? seedingRounds : 3;

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

  const teamRowData = buildTeamRowData(
    teams,
    scores,
    rankings,
    effectiveRounds,
  );

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
          <SeedingScoresTable
            teamRowData={teamRowData}
            effectiveRounds={effectiveRounds}
          />

          <SeedingRankingsTable rankings={rankings} />

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
