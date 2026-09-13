import { queryOptions } from '@tanstack/react-query';
import { getSeedingRankings, getSeedingScores } from '../api/seeding';
import { publicEventKey, seedingKey } from './keys';

export function seedingScoresQueryOptions(userId: number, eventId: number) {
  return queryOptions({
    queryKey: [...seedingKey(userId, eventId), 'scores'],
    queryFn: ({ signal }) => getSeedingScores(eventId, signal),
  });
}

export function seedingRankingsQueryOptions(userId: number, eventId: number) {
  return queryOptions({
    queryKey: [...seedingKey(userId, eventId), 'rankings'],
    queryFn: ({ signal }) => getSeedingRankings(eventId, signal),
  });
}

export function publicSeedingScoresQueryOptions(eventId: number) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'seeding', 'scores'],
    queryFn: ({ signal }) => getSeedingScores(eventId, signal),
  });
}

export function publicSeedingRankingsQueryOptions(eventId: number) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'seeding', 'rankings'],
    queryFn: ({ signal }) => getSeedingRankings(eventId, signal),
  });
}
