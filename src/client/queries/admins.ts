import { queryOptions } from '@tanstack/react-query';
import { getAdminUsers } from '../api/admins';
import { adminScopeKey } from './keys';
import { ADMIN_ONLY_QUERY_META } from './invalidation';

export const adminUsersQueryOptions = (userId: number) =>
  queryOptions({
    queryKey: [...adminScopeKey(userId), 'users'],
    queryFn: ({ signal }) => getAdminUsers(signal),
    staleTime: 0,
    refetchInterval: 30_000,
    meta: ADMIN_ONLY_QUERY_META,
  });
