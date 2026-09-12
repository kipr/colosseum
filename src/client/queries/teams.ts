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
import { teamsKey } from './keys';
import { canUpdateUserCache, type MutationScope } from './invalidation';

type TeamScope = MutationScope & { eventId: number };
export function teamsQueryOptions(
  userId: number,
  eventId: number,
  status: TeamStatus | 'all' = 'all',
) {
  return queryOptions({
    queryKey: [...teamsKey(userId, eventId), { status }],
    queryFn: ({ signal }) => getTeams(eventId, status, signal),
    staleTime: 30_000,
  });
}
export function useTeamMutations() {
  const client = useQueryClient();
  const refresh = async (_data: unknown, { userId, eventId }: TeamScope) => {
    if (canUpdateUserCache(client, userId))
      await client.invalidateQueries({ queryKey: teamsKey(userId, eventId) });
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
