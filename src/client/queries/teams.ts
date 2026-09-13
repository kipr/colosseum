import {
  queryOptions,
  useMutation,
  useQueryClient,
} from '@tanstack/react-query';
import {
  getTeams,
  saveTeam,
  deleteTeam,
  checkInTeam,
  importTeams,
  checkInTeams,
  type TeamStatus,
} from '../api/teams';
import { publicEventKey, teamsKey, judgeEventKey } from './keys';
import {
  invalidateTeamDependents,
  type EventMutationScope,
} from './invalidation';
import { LIST_STALE_TIME_MS } from './queryClient';

export function publicTeamsQueryOptions(eventId: number) {
  return queryOptions({
    queryKey: [...publicEventKey(eventId), 'teams'],
    queryFn: ({ signal }) => getTeams(eventId, 'all', signal),
    staleTime: LIST_STALE_TIME_MS,
  });
}
export function teamsQueryOptions(
  userId: number,
  eventId: number,
  status: TeamStatus | 'all' = 'all',
) {
  return queryOptions({
    queryKey: [...teamsKey(userId, eventId), { status }],
    queryFn: ({ signal }) => getTeams(eventId, status, signal),
    staleTime: LIST_STALE_TIME_MS,
  });
}
export function judgeTeamsQueryOptions(generation: string, eventId: number) {
  return queryOptions({
    queryKey: [...judgeEventKey(generation, eventId), 'teams'],
    queryFn: ({ signal }) => getTeams(eventId, 'all', signal),
    staleTime: LIST_STALE_TIME_MS,
  });
}
export function useTeamMutations() {
  const client = useQueryClient();
  const refresh = (_data: unknown, scope: EventMutationScope) =>
    invalidateTeamDependents(client, scope);
  const save = useMutation({
    mutationFn: (v: EventMutationScope & Parameters<typeof saveTeam>[0]) =>
      saveTeam(v),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (v: EventMutationScope & { teamId: number }) => deleteTeam(v),
    onSuccess: refresh,
  });
  const checkIn = useMutation({
    mutationFn: (v: EventMutationScope & { teamId: number }) => checkInTeam(v),
    onSuccess: refresh,
  });
  const bulkImport = useMutation({
    mutationFn: (v: EventMutationScope & Parameters<typeof importTeams>[0]) =>
      importTeams(v),
    onSuccess: (result, scope) =>
      result.created > 0 ? refresh(result, scope) : undefined,
  });
  const bulkCheckIn = useMutation({
    mutationFn: (v: EventMutationScope & Parameters<typeof checkInTeams>[0]) =>
      checkInTeams(v),
    onSuccess: refresh,
  });
  return { save, remove, checkIn, bulkImport, bulkCheckIn };
}
