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
import { RESULT_STALE_TIME_MS } from './queryClient';

export function doubleSeedingScoresQueryOptions(
  userId: number,
  eventId: number,
) {
  return queryOptions({
    queryKey: [...doubleSeedingKey(userId, eventId), 'scores'],
    queryFn: ({ signal }) => getDoubleSeedingScores(eventId, signal),
    staleTime: RESULT_STALE_TIME_MS,
  });
}

export function doubleSeedingRankingsQueryOptions(
  userId: number,
  eventId: number,
) {
  return queryOptions({
    queryKey: [...doubleSeedingKey(userId, eventId), 'rankings'],
    queryFn: ({ signal }) => getDoubleSeedingRankings(eventId, signal),
    staleTime: RESULT_STALE_TIME_MS,
  });
}

export function doubleSeedingMatchesQueryOptions(
  userId: number,
  eventId: number,
) {
  return queryOptions({
    queryKey: [...doubleSeedingKey(userId, eventId), 'matches'],
    queryFn: ({ signal }) => getDoubleSeedingMatches(eventId, signal),
    staleTime: RESULT_STALE_TIME_MS,
  });
}

export function publicDoubleSeedingScoresQueryOptions(eventId: number) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'double-seeding', 'scores'],
    queryFn: ({ signal }) => getDoubleSeedingScores(eventId, signal),
    staleTime: RESULT_STALE_TIME_MS,
  });
}

export function publicDoubleSeedingRankingsQueryOptions(eventId: number) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'double-seeding', 'rankings'],
    queryFn: ({ signal }) => getDoubleSeedingRankings(eventId, signal),
    staleTime: RESULT_STALE_TIME_MS,
  });
}

export function useDoubleSeedingMutations() {
  const client = useQueryClient();
  const generate = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope &
        Parameters<typeof generateDoubleSeedingMatches>[0],
    ) => generateDoubleSeedingMatches(v),
    onSuccess: async (_, scope) => {
      await invalidateDoubleSeedingDependents(client, scope, {
        eventMetadata: true,
      });
    },
  });
  const removeRound = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope & Parameters<typeof deleteDoubleSeedingRound>[0],
    ) => deleteDoubleSeedingRound(v),
    onSuccess: async (_, scope) => {
      await invalidateDoubleSeedingDependents(client, scope, {
        eventMetadata: true,
      });
    },
  });
  const recalculate = useMutation({
    meta: ADMIN_ONLY_QUERY_META,
    mutationFn: (
      v: EventMutationScope &
        Parameters<typeof recalculateDoubleSeedingRankings>[0],
    ) => recalculateDoubleSeedingRankings(v),
    onSuccess: async (_, scope) => {
      await invalidateDoubleSeedingDependents(client, scope);
    },
  });
  return { generate, removeRound, recalculate };
}
