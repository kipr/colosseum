import { createContext, useContext } from 'react';
import type { Event } from '../utils/eventStatus';

export interface EventContextType {
  selectedEvent: Event | null;
  events: Event[];
  loading: boolean;
  error: string | null;
  setSelectedEvent: (event: Event | null) => void;
  selectEventById: (id: number | null) => void;
}

export const EventContext = createContext<EventContextType | undefined>(
  undefined,
);

export function useEvent() {
  const context = useContext(EventContext);
  if (!context) {
    throw new Error('useEvent must be used within EventProvider');
  }
  return context;
}
