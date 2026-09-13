import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useEvent } from '../../contexts/EventContext';
import { teamsQueryOptions } from '../../queries/teams';
import {
  seedingRankingsQueryOptions,
  seedingScoresQueryOptions,
} from '../../queries/seeding';
import QueryFeedback, { queryData } from '../QueryFeedback';
import type { Team } from '../../api/teams';
import type { SeedingRanking, SeedingScore } from '../../api/seeding';
import SeedingDisplay from '../seeding/SeedingDisplay';
import './SeedingTab.css';

const EMPTY_TEAMS: Team[] = [];
const EMPTY_SCORES: SeedingScore[] = [];
const EMPTY_RANKINGS: SeedingRanking[] = [];

export default function SeedingTab() {
  const { selectedEvent } = useEvent();
  const { user, loading: authLoading } = useAuth();
  const selectedEventId = selectedEvent?.id ?? null;
  const userId = user?.id ?? 0;
  const enabled = Boolean(user && !authLoading && selectedEventId);
  const teamsQuery = useQuery({
    ...teamsQueryOptions(userId, selectedEventId ?? 0),
    enabled,
  });
  const scoresQuery = useQuery({
    ...seedingScoresQueryOptions(userId, selectedEventId ?? 0),
    enabled,
  });
  const rankingsQuery = useQuery({
    ...seedingRankingsQueryOptions(userId, selectedEventId ?? 0),
    enabled,
  });
  const teams = queryData(teamsQuery) ?? EMPTY_TEAMS;
  const scores = queryData(scoresQuery) ?? EMPTY_SCORES;
  const rankings = queryData(rankingsQuery) ?? EMPTY_RANKINGS;
  const loading =
    teamsQuery.isLoading || scoresQuery.isLoading || rankingsQuery.isLoading;
  const errorQuery = [teamsQuery, scoresQuery, rankingsQuery].find(
    (query) => query.isError,
  );
  const effectiveRounds =
    (selectedEvent?.seeding_rounds ?? 0) > 0
      ? (selectedEvent?.seeding_rounds ?? 3)
      : 3;

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
      {errorQuery ? <QueryFeedback query={errorQuery} /> : null}
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
        />
      )}
    </div>
  );
}
