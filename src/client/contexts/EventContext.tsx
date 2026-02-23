import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { useAuth } from './AuthContext';
import { Event, isEventActive } from '../utils/eventStatus';

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

export function EventProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEventState] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const refreshEvents = useCallback(async () => {
    if (!user) {
      setEvents([]);
      setSelectedEventState(null);
      setLoading(false);
      return [];
    }

    try {
      setError(null);
      setLoading(true);
      const response = await fetch('/events', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch events');
      }

      const data: Event[] = await response.json();
      setEvents(data);
      return data;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch events';
      setError(message);
      console.error('Error fetching events:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [user]);

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

  // Initial load
  useEffect(() => {
    const initializeEvents = async () => {
      if (authLoading) return;

      if (!user) {
        setEvents([]);
        setSelectedEventState(null);
        setLoading(false);
        setInitialized(false);
        return;
      }

      const fetchedEvents = await refreshEvents();

      // Try to restore last selected event from localStorage
      const savedEventId = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (savedEventId && fetchedEvents.length > 0) {
        const savedEvent = fetchedEvents.find(
          (e: Event) => e.id === Number(savedEventId),
        );
        if (savedEvent) {
          setSelectedEventState(savedEvent);
        } else {
          // Saved event no longer exists, prefer active/setup event then fallback.
          const nextEvent =
            fetchedEvents.find((event) => isEventActive(event.status)) ||
            fetchedEvents[0];
          setSelectedEventState(nextEvent);
          localStorage.setItem(LOCAL_STORAGE_KEY, String(nextEvent.id));
        }
      } else if (fetchedEvents.length > 0) {
        // No saved selection, prefer active/setup event then fallback.
        const nextEvent =
          fetchedEvents.find((event) => isEventActive(event.status)) ||
          fetchedEvents[0];
        setSelectedEventState(nextEvent);
        localStorage.setItem(LOCAL_STORAGE_KEY, String(nextEvent.id));
      }

      setInitialized(true);
    };

    initializeEvents();
  }, [authLoading, refreshEvents, user]);

  // Update selectedEvent if it was edited/deleted
  useEffect(() => {
    if (!initialized || !selectedEvent) return;

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
  }, [events, initialized, selectedEvent, setSelectedEvent]);

  return (
    <EventContext.Provider
      value={{
        selectedEvent,
        events,
        loading,
        error,
        refreshEvents,
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
