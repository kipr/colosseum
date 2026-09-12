import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  calculateBracketRankings,
  createBracket,
  deleteBracket,
  generateBracketEntries,
  generateBracketGames,
  getAssignedTeams,
  getBracket,
  getBracketRankings,
  getBrackets,
  getPublicBracketRankings,
  updateBracket,
} from '../api/brackets';
import {
  assignedTeamsKey,
  bracketKey,
  bracketsKey,
  publicEventKey,
} from './keys';
import {
  invalidateBracketDependents,
  type EventMutationScope,
} from './invalidation';
import { LIST_STALE_TIME_MS, RESULT_STALE_TIME_MS } from './queryClient';

type BracketScope = EventMutationScope & { bracketId?: number };

export function bracketsQueryOptions(userId: number, eventId: number) {
  return queryOptions({
    queryKey: bracketsKey(userId, eventId),
    queryFn: ({ signal }) => getBrackets(eventId, signal),
    staleTime: LIST_STALE_TIME_MS,
  });
}

export function publicBracketsQueryOptions(eventId: number) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'brackets'],
    queryFn: ({ signal }) => getBrackets(eventId, signal),
    staleTime: LIST_STALE_TIME_MS,
  });
}

export function bracketQueryOptions(
  userId: number,
  eventId: number,
  bracketId: number,
) {
  return queryOptions({
    queryKey: bracketKey(userId, eventId, bracketId),
    queryFn: ({ signal }) => getBracket(bracketId, signal),
    staleTime: RESULT_STALE_TIME_MS,
  });
}

export function publicBracketQueryOptions(eventId: number, bracketId: number) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'bracket', bracketId],
    queryFn: ({ signal }) => getBracket(bracketId, signal),
    staleTime: RESULT_STALE_TIME_MS,
  });
}

export function bracketRankingsQueryOptions(
  userId: number,
  eventId: number,
  bracketId: number,
) {
  return queryOptions({
    queryKey: [...bracketKey(userId, eventId, bracketId), 'rankings'],
    queryFn: ({ signal }) => getBracketRankings(bracketId, signal),
    staleTime: RESULT_STALE_TIME_MS,
  });
}

export function publicBracketRankingsQueryOptions(
  eventId: number,
  bracketId: number,
) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'bracket', bracketId, 'rankings'],
    queryFn: ({ signal }) => getPublicBracketRankings(bracketId, signal),
    staleTime: RESULT_STALE_TIME_MS,
  });
}

export function assignedTeamsQueryOptions(userId: number, eventId: number) {
  return queryOptions({
    queryKey: assignedTeamsKey(userId, eventId),
    queryFn: ({ signal }) => getAssignedTeams(eventId, signal),
    staleTime: LIST_STALE_TIME_MS,
  });
}

export function useBracketMutations() {
  const client = useQueryClient();
  const refresh = async (_data: unknown, scope: BracketScope) => {
    await invalidateBracketDependents(client, scope);
  };
  const create = useMutation({
    mutationFn: (v: EventMutationScope & Parameters<typeof createBracket>[0]) =>
      createBracket(v),
    onSuccess: refresh,
  });
  const update = useMutation({
    mutationFn: (v: BracketScope & Parameters<typeof updateBracket>[0]) =>
      updateBracket(v),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (v: BracketScope & { bracketId: number }) => deleteBracket(v),
    onSuccess: async (_, scope) => {
      await client.cancelQueries({
        queryKey: bracketKey(scope.userId, scope.eventId, scope.bracketId),
      });
      client.removeQueries({
        queryKey: bracketKey(scope.userId, scope.eventId, scope.bracketId),
      });
      await refresh(_, scope);
    },
  });
  const generateEntries = useMutation({
    mutationFn: (
      v: BracketScope & Parameters<typeof generateBracketEntries>[0],
    ) => generateBracketEntries(v),
    onSuccess: refresh,
  });
  const generateGames = useMutation({
    mutationFn: (
      v: BracketScope & Parameters<typeof generateBracketGames>[0],
    ) => generateBracketGames(v),
    onSuccess: refresh,
  });
  const calculateRankings = useMutation({
    mutationFn: (
      v: BracketScope & Parameters<typeof calculateBracketRankings>[0],
    ) => calculateBracketRankings(v),
    onSuccess: refresh,
  });
  return {
    create,
    update,
    remove,
    generateEntries,
    generateGames,
    calculateRankings,
  };
}
