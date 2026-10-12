import type { TeamSummary } from '../../types/teams';
import { apiFetch } from '../../utils/api';
import type {
  DoubleSeedingRanking,
  DoubleSeedingScore,
  SeedingRanking,
  SeedingScore,
} from './SeedingScoresTable';

/** Teams, scores and rankings for an event's seeding tables. */
export async function loadSeeding(eventId: number, signal?: AbortSignal) {
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
}

/** Double-seeding scores and rankings for an event. */
export async function loadDoubleSeeding(eventId: number, signal?: AbortSignal) {
  const [scores, rankings] = await Promise.all([
    apiFetch<DoubleSeedingScore[]>(`/double-seeding/scores/event/${eventId}`, {
      signal,
      fallbackError: 'Failed to fetch double-seeding scores',
    }),
    apiFetch<DoubleSeedingRanking[]>(
      `/double-seeding/rankings/event/${eventId}`,
      { signal, fallbackError: 'Failed to fetch rankings' },
    ),
  ]);
  return { scores, rankings };
}
