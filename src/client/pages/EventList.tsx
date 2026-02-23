import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import {
  getEventStatusClass,
  getEventStatusLabel,
  formatEventDate,
} from '../utils/eventStatus';
import './EventList.css';

interface PublicEvent {
  id: number;
  name: string;
  status: string;
  event_date: string | null;
  location: string | null;
  seeding_rounds: number;
}

export default function EventList() {
  const [events, setEvents] = useState<PublicEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await fetch('/events/public');
        if (!response.ok) throw new Error('Failed to fetch events');
        const data: PublicEvent[] = await response.json();
        setEvents(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load events');
      } finally {
        setLoading(false);
      }
    };
    fetchEvents();
  }, []);

  return (
    <div className="event-list-page">
      <Navbar />
      <div className="event-list-content">
        <h1>Events</h1>

        {loading && <p>Loading events...</p>}

        {error && (
          <div className="card">
            <p style={{ color: 'var(--danger-color)' }}>{error}</p>
          </div>
        )}

        {!loading && !error && events.length === 0 && (
          <div className="card">
            <p style={{ color: 'var(--secondary-color)' }}>
              No events available at this time.
            </p>
          </div>
        )}

        {!loading && events.length > 0 && (
          <div className="event-cards">
            {events.map((event) => (
              <Link
                key={event.id}
                to={`/event/${event.id}`}
                className="event-card-link"
              >
                <div className="card event-card">
                  <div className="event-card-header">
                    <h2>{event.name}</h2>
                    <span
                      className={`event-status-dot ${getEventStatusClass(event.status)}`}
                    >
                      {getEventStatusLabel(event.status)}
                    </span>
                  </div>
                  <div className="event-card-details">
                    {event.event_date && (
                      <span>{formatEventDate(event.event_date)}</span>
                    )}
                    {event.location && <span>{event.location}</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
