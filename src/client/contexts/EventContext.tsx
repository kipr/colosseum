import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  ReactNode,
} from 'react';

// Event type matching the API schema
export interface Event {
  id: number;
  name: string;
  description: string | null;
  event_date: string | null;
  location: string | null;
  status: 'setup' | 'active' | 'complete' | 'archived';
  seeding_rounds: number;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  // Optional aggregated counts (computed client-side or via API extension)
  teams_count?: number;
  brackets_count?: number;
}

// Status display mapping: API status -> UI label
export const STATUS_LABELS: Record<Event['status'], string> = {
  setup: 'Setup',
  active: 'Live',
  complete: 'Complete',
  archived: 'Archived',
};

// Status options for forms
export const STATUS_OPTIONS: { value: Event['status']; label: string }[] = [
  { value: 'setup', label: 'Setup' },
  { value: 'active', label: 'Live' },
  { value: 'complete', label: 'Complete' },
  { value: 'archived', label: 'Archived' },
];

interface EventContextType {
  selectedEvent: Event | null;
  events: Event[];
  loading: boolean;
  error: string | null;
  refreshEvents: () => Promise<void>;
  setSelectedEvent: (event: Event | null) => void;
  selectEventById: (id: number) => void;
}

const EventContext = createContext<EventContextType | undefined>(undefined);

const LOCAL_STORAGE_KEY = 'colosseum_selected_event_id';

export function EventProvider({ children }: { children: ReactNode }) {
  const [events, setEvents] = useState<Event[]>([]);
  const [selectedEvent, setSelectedEventState] = useState<Event | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  const refreshEvents = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch('/events', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch events');
      }

      const data = await response.json();
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
  }, []);

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
    (id: number) => {
      const event = events.find((e) => e.id === id);
      setSelectedEvent(event || null);
    },
    [events, setSelectedEvent],
  );

  // Initial load
  useEffect(() => {
    const initializeEvents = async () => {
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
          // Saved event no longer exists, auto-select first event
          setSelectedEventState(fetchedEvents[0]);
          localStorage.setItem(LOCAL_STORAGE_KEY, String(fetchedEvents[0].id));
        }
      } else if (fetchedEvents.length > 0) {
        // No saved selection, auto-select first event
        setSelectedEventState(fetchedEvents[0]);
        localStorage.setItem(LOCAL_STORAGE_KEY, String(fetchedEvents[0].id));
      }

      setInitialized(true);
    };

    initializeEvents();
  }, [refreshEvents]);

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
