import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import { Event, isEventActive } from '../utils/eventStatus';
import { apiFetch } from '../utils/api';

interface EventContextType {
  selectedEvent: Event | null;
  events: Event[];
  loading: boolean;
  error: string | null;
  refreshEvents: (options?: { background?: boolean }) => Promise<Event[]>;
  beginEventMutation: () => (event: Event) => void;
  setSelectedEvent: (event: Event | null) => void;
  selectEventById: (id: number | null) => void;
}

const EventContext = createContext<EventContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'colosseum_selected_event_id';

export function EventProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEventState] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const initialized = useRef(false);
  const hydrated = useRef(false);
  const requestSequence = useRef(0);
  const cacheGeneration = useRef(0);
  // Retired scopes stay inactive, even if the same user later returns.
  const authScope = useMemo(
    () => ({ user, active: false }),
    [user, authLoading],
  );

  const refreshEvents = useCallback(
    async (options?: { background?: boolean }) => {
      if (!authScope.active) return [];

      const request = ++requestSequence.current;
      if (!authScope.user) {
        setEvents([]);
        setSelectedEventState(null);
        setLoading(false);
        initialized.current = false;
        return [];
      }

      try {
        setError(null);
        setLoading(!options?.background || !hydrated.current);
        const data = await apiFetch<Event[]>('/events', {
          fallbackError: 'Failed to fetch events',
        });
        if (request !== requestSequence.current) return data;

        ++cacheGeneration.current;
        hydrated.current = true;
        setEvents(data);

        // Only an accepted response may initialize selection, even if the first
        // refresh was superseded by another read or a saved event.
        if (!initialized.current) {
          const savedEventId = localStorage.getItem(LOCAL_STORAGE_KEY);
          const savedEvent = savedEventId
            ? data.find((event) => event.id === Number(savedEventId))
            : undefined;
          const nextEvent =
            savedEvent ||
            data.find((event) => isEventActive(event.status)) ||
            data[0];
          if (nextEvent) {
            setSelectedEventState(nextEvent);
            if (!savedEvent) {
              localStorage.setItem(LOCAL_STORAGE_KEY, String(nextEvent.id));
            }
          }
          initialized.current = true;
        }

        return data;
      } catch (err) {
        if (request === requestSequence.current) {
          const message =
            err instanceof Error ? err.message : 'Failed to fetch events';
          setError(message);
          initialized.current = true;
          console.error('Error fetching events:', err);
        }
        return [];
      } finally {
        if (request === requestSequence.current) setLoading(false);
      }
    },
    [authScope],
  );

  // Capture freshness before sending a mutation, not when its response arrives.
  // An intervening accepted read or save makes that response ambiguous; leave
  // the confirmed cache intact and let the caller's post-save refresh resolve it.
  const beginEventMutation = useCallback(() => {
    const generation = cacheGeneration.current;
    return (event: Event) => {
      if (
        !authScope.active ||
        !authScope.user ||
        generation !== cacheGeneration.current
      ) {
        return;
      }

      ++cacheGeneration.current;
      // An accepted write supersedes reads started before it was saved.
      ++requestSequence.current;
      setEvents((current) =>
        current.some((existing) => existing.id === event.id)
          ? current.map((existing) =>
              existing.id === event.id ? event : existing,
            )
          : [...current, event],
      );
      setSelectedEventState((current) =>
        current?.id === event.id ? event : current,
      );
      setError(null);
      setLoading(false);
    };
  }, [authScope]);

  // Set selected event and persist to localStorage
  const setSelectedEvent = useCallback((event: Event | null) => {
    setSelectedEventState(event);
    if (event) {
      localStorage.setItem(LOCAL_STORAGE_KEY, String(event.id));
    } else {
      localStorage.removeItem(LOCAL_STORAGE_KEY);
    }
  }, []);

  // Select event by ID (useful for dropdown changes)
  const selectEventById = useCallback(
    (id: number | null) => {
      if (id === null) {
        setSelectedEvent(null);
        return;
      }

      const event = events.find((e) => e.id === id) || null;
      setSelectedEvent(event);
    },
    [events, setSelectedEvent],
  );

  // Initial load and auth changes define the lifetime of pending reads.
  useEffect(() => {
    authScope.active = !authLoading;
    initialized.current = false;
    hydrated.current = false;
    if (!authLoading) void refreshEvents();

    return () => {
      authScope.active = false;
      ++requestSequence.current;
    };
  }, [authLoading, authScope, refreshEvents]);

  // Update selectedEvent if it was edited/deleted
  useEffect(() => {
    if (!initialized.current || !selectedEvent) return;

    const currentEvent = events.find((e) => e.id === selectedEvent.id);
    if (currentEvent) {
      // Update with latest data if changed
      if (JSON.stringify(currentEvent) !== JSON.stringify(selectedEvent)) {
        setSelectedEventState(currentEvent);
      }
    } else {
      // Selected event was deleted, select first available or null
      if (events.length > 0) {
        setSelectedEvent(events[0]);
      } else {
        setSelectedEvent(null);
      }
    }
  }, [events, selectedEvent, setSelectedEvent]);

  return (
    <EventContext.Provider
      value={{
        selectedEvent,
        events,
        loading,
        error,
        refreshEvents,
        beginEventMutation,
        setSelectedEvent,
        selectEventById,
      }}
    >
      {children}
    </EventContext.Provider>
  );
}

export function useEvent() {
  const context = useContext(EventContext);
  if (!context) {
    throw new Error('useEvent must be used within EventProvider');
  }
  return context;
}
