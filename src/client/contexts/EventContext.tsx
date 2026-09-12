import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ApiError } from '../api/http';
import { useAuth } from './AuthContext';
import { Event, isEventActive } from '../utils/eventStatus';
import { adminEventsQueryOptions } from '../queries/events';
import { adminEventsKey, authUserKey } from '../queries/keys';
import { adminEventsPath, isAdminView } from '../utils/routes';

interface EventContextType {
  selectedEvent: Event | null;
  events: Event[];
  loading: boolean;
  error: string | null;
  refreshEvents: () => Promise<Event[]>;
  setSelectedEvent: (event: Event | null) => void;
  selectEventById: (id: number | null) => void;
}

const EventContext = createContext<EventContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'colosseum_selected_event_id';
const EMPTY_EVENTS: Event[] = [];

function parseRouteEventId(
  param: string | undefined,
): number | 'invalid' | null {
  if (param == null || param === '') return null;
  if (!/^\d+$/.test(param)) return 'invalid';
  const id = Number(param);
  if (!Number.isInteger(id) || id <= 0) return 'invalid';
  return id;
}

function readStoredEventId(): number | null {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw == null || raw === '') return null;
    if (!/^\d+$/.test(raw)) return null;
    const id = Number(raw);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null;
  }
}

function persistEventId(id: number | null): void {
  try {
    if (id == null) {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    } else {
      localStorage.setItem(LOCAL_STORAGE_KEY, String(id));
    }
  } catch {
    // Ignore quota / private-mode failures; selection still works in memory.
  }
}

function fallbackEventId(events: Event[]): number | null {
  if (events.length === 0) return null;
  return (
    events.find((event) => isEventActive(event.status))?.id ?? events[0].id
  );
}

function eventErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Failed to fetch events';
}

export function EventProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { eventId: eventIdParam } = useParams<{ eventId?: string }>();
  const [searchParams] = useSearchParams();

  const [selectedEventId, setSelectedEventId] = useState<number | null>(null);
  const [initializedForUser, setInitializedForUser] = useState<number | null>(
    null,
  );
  const explicitNullRef = useRef(false);
  const userIdRef = useRef<number | undefined>(user?.id);
  userIdRef.current = user?.id;

  const eventsQueryEnabled = Boolean(user) && !authLoading;
  const eventsQuery = useQuery({
    ...adminEventsQueryOptions(user?.id ?? 0),
    enabled: eventsQueryEnabled,
  });

  useEffect(() => {
    if (!eventsQuery.isError) return;
    const error = eventsQuery.error;
    if (!(error instanceof ApiError) || error.status !== 401) return;

    const originUserId = userIdRef.current;
    if (originUserId == null) return;

    void (async () => {
      await queryClient.cancelQueries({
        queryKey: adminEventsKey(originUserId),
      });
      queryClient.removeQueries({ queryKey: adminEventsKey(originUserId) });
      if (userIdRef.current === originUserId) {
        await queryClient.invalidateQueries({ queryKey: authUserKey });
      }
    })();
  }, [eventsQuery.error, eventsQuery.isError, queryClient]);

  const events: Event[] =
    user && !authLoading ? (eventsQuery.data ?? EMPTY_EVENTS) : EMPTY_EVENTS;
  const listSucceeded = eventsQueryEnabled && eventsQuery.isSuccess;
  const routeEventId = parseRouteEventId(eventIdParam);

  const effectiveSelectedId = useMemo(() => {
    if (typeof routeEventId === 'number') {
      return routeEventId;
    }
    return selectedEventId;
  }, [routeEventId, selectedEventId]);

  const selectedEvent =
    effectiveSelectedId == null
      ? null
      : (events.find((event) => event.id === effectiveSelectedId) ?? null);

  const applySelection = useCallback(
    (id: number | null, options: { explicit: boolean; persist: boolean }) => {
      if (options.explicit) {
        explicitNullRef.current = id == null;
      } else if (id != null) {
        explicitNullRef.current = false;
      }
      setSelectedEventId(id);
      if (user?.id != null) {
        setInitializedForUser(user.id);
      }
      if (options.persist) {
        persistEventId(id);
      }
    },
    [user?.id],
  );

  const setSelectedEvent = useCallback(
    (event: Event | null) => {
      applySelection(event ? event.id : null, {
        explicit: true,
        persist: true,
      });
    },
    [applySelection],
  );

  const selectEventById = useCallback(
    (id: number | null) => {
      applySelection(id, { explicit: true, persist: true });
    },
    [applySelection],
  );

  useLayoutEffect(() => {
    if (authLoading) {
      return;
    }

    if (!user) {
      explicitNullRef.current = false;
      setSelectedEventId(null);
      setInitializedForUser(null);
      return;
    }

    if (eventsQuery.data === undefined && eventsQuery.isPending) {
      return;
    }

    const list = eventsQuery.data ?? [];

    if (routeEventId === 'invalid') {
      return;
    }

    if (typeof routeEventId === 'number') {
      const found = list.some((event) => event.id === routeEventId);
      if (found) {
        applySelection(routeEventId, { explicit: false, persist: true });
        return;
      }
      if (listSucceeded) {
        return;
      }
      applySelection(routeEventId, { explicit: false, persist: false });
      return;
    }

    if (initializedForUser === user.id) {
      if (explicitNullRef.current) {
        applySelection(null, { explicit: true, persist: true });
        return;
      }
      if (selectedEventId != null) {
        const found = list.some((event) => event.id === selectedEventId);
        if (found) {
          applySelection(selectedEventId, { explicit: false, persist: true });
          return;
        }
        if (listSucceeded) {
          const fallback = fallbackEventId(list);
          applySelection(fallback, {
            explicit: false,
            persist: true,
          });
        }
      }
      return;
    }

    if (listSucceeded && list.length === 0) {
      applySelection(null, { explicit: false, persist: true });
      return;
    }

    const savedId = readStoredEventId();
    if (savedId != null) {
      const savedEvent = list.find((event) => event.id === savedId);
      if (savedEvent) {
        applySelection(savedId, { explicit: false, persist: true });
        return;
      }
      if (!listSucceeded) {
        applySelection(savedId, { explicit: false, persist: false });
        return;
      }
    }

    if (!listSucceeded) {
      return;
    }

    applySelection(fallbackEventId(list), { explicit: false, persist: true });
  }, [
    applySelection,
    authLoading,
    eventsQuery.data,
    eventsQuery.isPending,
    initializedForUser,
    listSucceeded,
    routeEventId,
    selectedEventId,
    user,
  ]);

  useEffect(() => {
    if (!user || authLoading || !listSucceeded) {
      return;
    }

    const viewRaw = searchParams.get('view');
    const view = isAdminView(viewRaw) ? viewRaw : undefined;

    if (routeEventId === 'invalid') {
      navigate(adminEventsPath(view), { replace: true });
      return;
    }

    if (typeof routeEventId === 'number') {
      const found = events.some((event) => event.id === routeEventId);
      if (!found) {
        navigate(adminEventsPath(view), { replace: true });
      }
    }
  }, [
    authLoading,
    events,
    listSucceeded,
    navigate,
    routeEventId,
    searchParams,
    user,
  ]);

  const refreshEvents = useCallback(async () => {
    if (!user) {
      return [];
    }

    const originUserId = user.id;
    try {
      const data = await queryClient.fetchQuery({
        ...adminEventsQueryOptions(originUserId),
        staleTime: 0,
      });
      if (userIdRef.current !== originUserId) {
        return [];
      }
      return data;
    } catch (err) {
      console.error('Error fetching events:', err);
      return [];
    }
  }, [queryClient, user]);

  const awaitingEvents =
    Boolean(user) &&
    !authLoading &&
    eventsQuery.data === undefined &&
    !eventsQuery.isError;
  const awaitingInit =
    Boolean(user) &&
    !authLoading &&
    eventsQuery.data !== undefined &&
    initializedForUser !== user?.id &&
    typeof routeEventId !== 'number';
  const awaitingRoute =
    Boolean(user) &&
    !authLoading &&
    typeof routeEventId === 'number' &&
    selectedEvent == null &&
    eventsQuery.data === undefined &&
    !eventsQuery.isError;

  const loading =
    authLoading || awaitingEvents || awaitingInit || awaitingRoute;
  const error =
    eventsQueryEnabled && eventsQuery.isError
      ? eventErrorMessage(eventsQuery.error)
      : null;

  const value = useMemo(
    () => ({
      selectedEvent,
      events,
      loading,
      error,
      refreshEvents,
      setSelectedEvent,
      selectEventById,
    }),
    [
      selectedEvent,
      events,
      loading,
      error,
      refreshEvents,
      setSelectedEvent,
      selectEventById,
    ],
  );

  return (
    <EventContext.Provider value={value}>{children}</EventContext.Provider>
  );
}

export function useEvent() {
  const context = useContext(EventContext);
  if (!context) {
    throw new Error('useEvent must be used within EventProvider');
  }
  return context;
}
