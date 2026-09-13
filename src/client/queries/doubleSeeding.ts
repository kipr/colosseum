import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  deleteDoubleSeedingRound,
  generateDoubleSeedingMatches,
  getDoubleSeedingMatches,
  getDoubleSeedingRankings,
  getDoubleSeedingScores,
  recalculateDoubleSeedingRankings,
} from '../api/doubleSeeding';
import { doubleSeedingKey, publicEventKey } from './keys';
import {
  ADMIN_ONLY_QUERY_META,
  invalidateDoubleSeedingDependents,
  type EventMutationScope,
} from './invalidation';

export function doubleSeedingScoresQueryOptions(
  userId: number,
  eventId: number,
) {
  return queryOptions({
    queryKey: [...doubleSeedingKey(userId, eventId), 'scores'],
    queryFn: ({ signal }) => getDoubleSeedingScores(eventId, signal),
  });
}

export function doubleSeedingRankingsQueryOptions(
  userId: number,
  eventId: number,
) {
  return queryOptions({
    queryKey: [...doubleSeedingKey(userId, eventId), 'rankings'],
    queryFn: ({ signal }) => getDoubleSeedingRankings(eventId, signal),
  });
}

export function doubleSeedingMatchesQueryOptions(
  userId: number,
  eventId: number,
) {
  return queryOptions({
    queryKey: [...doubleSeedingKey(userId, eventId), 'matches'],
    queryFn: ({ signal }) => getDoubleSeedingMatches(eventId, signal),
  });
}

export function publicDoubleSeedingScoresQueryOptions(eventId: number) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'double-seeding', 'scores'],
    queryFn: ({ signal }) => getDoubleSeedingScores(eventId, signal),
  });
}

export function publicDoubleSeedingRankingsQueryOptions(eventId: number) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'double-seeding', 'rankings'],
    queryFn: ({ signal }) => getDoubleSeedingRankings(eventId, signal),
  });
}

export function useDoubleSeedingMutations() {
  const client = useQueryClient();
  const refreshMetadata = (_: unknown, scope: EventMutationScope) =>
    invalidateDoubleSeedingDependents(client, scope, { eventMetadata: true });
  const generate = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope &
        Parameters<typeof generateDoubleSeedingMatches>[0],
    ) => generateDoubleSeedingMatches(v),
    onSuccess: refreshMetadata,
  });
  const removeRound = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof deleteDoubleSeedingRound>[0],
    ) => deleteDoubleSeedingRound(v),
    onSuccess: refreshMetadata,
  });
  const recalculate = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope &
        Parameters<typeof recalculateDoubleSeedingRankings>[0],
    ) => recalculateDoubleSeedingRankings(v),
    onSuccess: (_, scope) => invalidateDoubleSeedingDependents(client, scope),
  });
  return { generate, removeRound, recalculate };
}
