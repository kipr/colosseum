import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import {
  SEEDING_TABLE_CONFIG,
  type SeedingScore,
  type SeedingRanking,
} from '../seeding/SeedingScoresTable';
import type { TeamSummary } from '../../types/teams';
import { apiFetch } from '../../utils/api';
import SeedingDisplay from '../seeding/SeedingDisplay';
import './SeedingTab.css';

export default function SeedingTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;
  const seedingRounds = selectedEvent?.seeding_rounds ?? 3;
  const [teams, setTeams] = useState<TeamSummary[]>([]);
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
      const [teamsData, scoresData, rankingsData] = await Promise.all([
        apiFetch<TeamSummary[]>(`/teams/event/${selectedEventId}`, {
          fallbackError: 'Failed to fetch teams',
        }),
        apiFetch<SeedingScore[]>(`/seeding/scores/event/${selectedEventId}`, {
          fallbackError: 'Failed to fetch seeding scores',
        }),
        apiFetch<SeedingRanking[]>(
          `/seeding/rankings/event/${selectedEventId}`,
          { fallbackError: 'Failed to fetch rankings' },
        ),
      ]);

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
        <SeedingDisplay
          teams={teams}
          scores={scores}
          rankings={rankings}
          effectiveRounds={effectiveRounds}
          config={SEEDING_TABLE_CONFIG}
        />
      )}

      {toast.ToastContainer}
    </div>
  );
}
