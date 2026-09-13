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
import { publicEventKey, teamsKey } from './keys';
import { invalidateTeamDependents, type MutationScope } from './invalidation';
import { LIST_STALE_TIME_MS } from './queryClient';

type TeamScope = MutationScope & { eventId: number };
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
export function useTeamMutations() {
  const client = useQueryClient();
  const refresh = async (_data: unknown, scope: TeamScope) => {
    await invalidateTeamDependents(client, scope);
  };
  const save = useMutation({
    mutationFn: (v: TeamScope & Parameters<typeof saveTeam>[0]) => saveTeam(v),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (v: TeamScope & { teamId: number }) => deleteTeam(v),
    onSuccess: refresh,
  });
  const checkIn = useMutation({
    mutationFn: (v: TeamScope & { teamId: number }) => checkInTeam(v),
    onSuccess: refresh,
  });
  const bulkImport = useMutation({
    mutationFn: (v: TeamScope & Parameters<typeof importTeams>[0]) =>
      importTeams(v),
    onSuccess: async (result, scope) => {
      if (result.created > 0) await refresh(result, scope);
    },
  });
  const bulkCheckIn = useMutation({
    mutationFn: (v: TeamScope & Parameters<typeof checkInTeams>[0]) =>
      checkInTeams(v),
    onSuccess: refresh,
  });
  return { save, remove, checkIn, bulkImport, bulkCheckIn };
}
