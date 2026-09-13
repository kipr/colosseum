import { queryOptions } from '@tanstack/react-query';
import { getSeedingRankings, getSeedingScores } from '../api/seeding';
import { publicEventKey, seedingKey } from './keys';
import { RESULT_STALE_TIME_MS } from './queryClient';

export function seedingScoresQueryOptions(userId: number, eventId: number) {
  return queryOptions({
    queryKey: [...seedingKey(userId, eventId), 'scores'],
    queryFn: ({ signal }) => getSeedingScores(eventId, signal),
    staleTime: RESULT_STALE_TIME_MS,
  });
}

export function seedingRankingsQueryOptions(userId: number, eventId: number) {
  return queryOptions({
    queryKey: [...seedingKey(userId, eventId), 'rankings'],
    queryFn: ({ signal }) => getSeedingRankings(eventId, signal),
    staleTime: RESULT_STALE_TIME_MS,
  });
}

export function publicSeedingScoresQueryOptions(eventId: number) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'seeding', 'scores'],
    queryFn: ({ signal }) => getSeedingScores(eventId, signal),
    staleTime: RESULT_STALE_TIME_MS,
  });
}

export function publicSeedingRankingsQueryOptions(eventId: number) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'seeding', 'rankings'],
    queryFn: ({ signal }) => getSeedingRankings(eventId, signal),
    staleTime: RESULT_STALE_TIME_MS,
  });
}
