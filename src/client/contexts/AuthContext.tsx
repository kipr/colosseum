import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionUser } from '../api/types';
import { authUserQueryOptions } from '../queries/auth';
import { authUserKey } from '../queries/keys';
import {
  removeAdminOnlyQueries,
  removeAdminUserQueries,
  removeJudgeQueries,
} from '../queries/invalidation';

interface AuthContextType {
  user: SessionUser | null;
  loading: boolean;
  serverAvailable: boolean;
  checkAuth: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function sameIdentity(
  left: SessionUser | null,
  right: SessionUser | null,
): boolean {
  if (left == null || right == null) {
    return left === right;
  }
  return left.id === right.id;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const query = useQuery(authUserQueryOptions());

  const [user, setUser] = useState<SessionUser | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  const userRef = useRef<SessionUser | null>(null);
  const transitionGeneration = useRef(0);

  userRef.current = user;

  useLayoutEffect(() => {
    if (query.isError) {
      return;
    }
    if (query.data === undefined) {
      return;
    }

    const nextUser = query.data;
    const previousUser = userRef.current;

    if (sameIdentity(previousUser, nextUser)) {
      if (
        previousUser &&
        nextUser &&
        Boolean(previousUser.isAdmin) !== Boolean(nextUser.isAdmin)
      ) {
        if (previousUser.isAdmin && !nextUser.isAdmin) {
          void removeAdminOnlyQueries(queryClient, previousUser.id);
        }
        setUser(nextUser);
      } else if (
        previousUser &&
        nextUser &&
        (previousUser.email !== nextUser.email ||
          previousUser.name !== nextUser.name)
      ) {
        setUser(nextUser);
      }
      return;
    }

    if (previousUser == null) {
      setUser(nextUser);
      setTransitioning(false);
      return;
    }

    const generation = ++transitionGeneration.current;
    setTransitioning(true);

    void (async () => {
      await removeAdminUserQueries(queryClient, previousUser.id);
      if (transitionGeneration.current !== generation) {
        return;
      }
      setUser(nextUser);
      setTransitioning(false);
    })();
  }, [query.data, query.dataUpdatedAt, query.isError, queryClient]);

  const checkAuth = useCallback(async () => {
    try {
      await queryClient.refetchQueries({ queryKey: authUserKey });
    } catch {
      // Failure is exposed through query state and context.
    }
  }, [queryClient]);

  const logout = useCallback(() => {
    const currentUser = userRef.current;
    void (async () => {
      await queryClient.cancelQueries({ queryKey: authUserKey });
      queryClient.setQueryData(authUserKey, null);
      if (currentUser) {
        await removeAdminUserQueries(queryClient, currentUser.id);
      }
      await removeJudgeQueries(queryClient);
      window.location.href = '/auth/logout';
    })();
  }, [queryClient]);

  const lookupFailed =
    query.failureCount > 0 || query.isError || query.failureReason != null;
  const serverAvailable = !lookupFailed;
  const confirmedSignedOut = query.isSuccess && query.data === null;
  const terminalLookupFailure =
    query.isError && !query.isFetching && query.data === undefined;
  const loading =
    transitioning ||
    (user == null && !confirmedSignedOut && !terminalLookupFailure);

  const value = useMemo(
    () => ({
      user,
      loading,
      serverAvailable,
      checkAuth,
      logout,
    }),
    [user, loading, serverAvailable, checkAuth, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
