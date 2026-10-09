import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import {
  SEEDING_TABLE_CONFIG,
  type SeedingScore,
  type SeedingRanking,
} from '../seeding/SeedingScoresTable';
import type { TeamSummary } from '../../types/teams';
import { apiFetch } from '../../utils/api';
import { useScopedLoad } from '../../hooks/useScopedLoad';
import SeedingDisplay from '../seeding/SeedingDisplay';
import './SeedingTab.css';

export default function SeedingTab() {
  const { selectedEvent } = useEvent();
  const selectedEventId = selectedEvent?.id ?? null;
  const seedingRounds = selectedEvent?.seeding_rounds ?? 3;
  const toast = useToast();

  const effectiveRounds = seedingRounds > 0 ? seedingRounds : 3;

  const {
    data: { teams, scores, rankings },
    loading,
  } = useScopedLoad(
    selectedEventId,
    async (eventId, signal) => {
      const [teams, scores, rankings] = await Promise.all([
        apiFetch<TeamSummary[]>(`/teams/event/${eventId}`, {
          signal,
          fallbackError: 'Failed to fetch teams',
        }),
        apiFetch<SeedingScore[]>(`/seeding/scores/event/${eventId}`, {
          signal,
          fallbackError: 'Failed to fetch seeding scores',
        }),
        apiFetch<SeedingRanking[]>(`/seeding/rankings/event/${eventId}`, {
          signal,
          fallbackError: 'Failed to fetch rankings',
        }),
      ]);
      return { teams, scores, rankings };
    },
    {
      initial: { teams: [], scores: [], rankings: [] },
      onError: (error) => {
        console.error('Error loading seeding data:', error);
        toast.error('Failed to load seeding data');
      },
    },
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
