import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  ReactNode,
} from 'react';
import { useLocation, useRouteLoaderData } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { Event } from '../utils/eventStatus';
import { SELECTED_EVENT_STORAGE_KEY } from '../loaders/adminLoader';

interface EventContextType {
  selectedEvent: Event | null;
  events: Event[];
  loading: boolean;
  error: string | null;
  refreshEvents: () => Promise<Event[]>;
}

const EventContext = createContext<EventContextType | undefined>(undefined);

export function EventProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const location = useLocation();
  const loadedEvent = useRouteLoaderData('admin-event') as Event | undefined;
  const [events, setEvents] = useState<Event[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const selectedEvent = useMemo(() => {
    if (!loadedEvent) return null;
    return events.find((event) => event.id === loadedEvent.id) ?? loadedEvent;
  }, [events, loadedEvent]);

  const refreshEvents = useCallback(async () => {
    if (!user) {
      setEvents([]);
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

  // Keep the event list available for selection; the route owns selection.
  useEffect(() => {
    const initializeEvents = async () => {
      if (authLoading) return;

      if (!user) {
        setEvents([]);
        setLoading(false);
        return;
      }

      await refreshEvents();
    };

    initializeEvents();
  }, [authLoading, refreshEvents, user]);

  // Persist only validated route selection. The explicit event-list route clears it.
  useEffect(() => {
    try {
      if (loadedEvent) {
        localStorage.setItem(
          SELECTED_EVENT_STORAGE_KEY,
          String(loadedEvent.id),
        );
      } else if (location.pathname === '/admin/events') {
        localStorage.removeItem(SELECTED_EVENT_STORAGE_KEY);
      }
    } catch {
      // URL-backed selection still works when storage is unavailable.
    }
  }, [loadedEvent, location.pathname]);

  return (
    <EventContext.Provider
      value={{
        selectedEvent,
        events,
        loading,
        error,
        refreshEvents,
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
