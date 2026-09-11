import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import { publicEventsQueryOptions } from '../queries/events';
import type { PublicEvent } from '../api/types';
import {
  formatEventDate,
  getEventStatusClass,
  getEventStatusLabel,
} from '../utils/eventStatus';
import { spectatorEventPath } from '../utils/routes';
import './SpectatorShared.css';
import './SpectatorEvents.css';

function EventCards({ events }: { events: PublicEvent[] }) {
  const navigate = useNavigate();

  const handleEventClick = (eventId: number) => {
    navigate(spectatorEventPath(eventId, 'seeding'));
  };

  if (events.length === 0) {
    return (
      <div className="card">
        <p className="spectator-muted-message">
          No events are currently available.
        </p>
      </div>
    );
  }

  return (
    <div className="spectator-events-grid">
      {events.map((event) => (
        <div
          key={event.id}
          className="spectator-event-card"
          role="button"
          tabIndex={0}
          onClick={() => handleEventClick(event.id)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              handleEventClick(event.id);
            }
          }}
        >
          <div className="spectator-event-card-header spectator-status-cluster">
            <span
              className={`event-status-badge ${getEventStatusClass(event.status)}`}
            >
              {getEventStatusLabel(event.status)}
            </span>
          </div>
          <h3>{event.name}</h3>
          <div className="spectator-event-card-details">
            {event.event_date && (
              <span className="spectator-event-card-detail">
                <span aria-hidden>📅</span> {formatEventDate(event.event_date)}
              </span>
            )}
            {event.location && (
              <span className="spectator-event-card-detail">
                <span aria-hidden>📍</span> {event.location}
              </span>
            )}
          </div>
          {event.final_scores_available && (
            <span className="spectator-event-card-badge">
              Final results available
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export default function SpectatorEvents() {
  const { data, error, isPending, isError, isFetching, isPaused, refetch } =
    useQuery(publicEventsQueryOptions());

  let body;
  if (isPaused && data === undefined && !isFetching) {
    body = (
      <div className="card spectator-events-status" role="status">
        <p>Waiting for a network connection to load events.</p>
      </div>
    );
  } else if (data === undefined && (isPending || isFetching)) {
    body = <p>Loading events...</p>;
  } else if (data === undefined && isError) {
    body = (
      <div className="card spectator-events-status" role="alert">
        <p>Unable to load events.</p>
        {error instanceof Error && error.message ? (
          <p className="spectator-muted-message">{error.message}</p>
        ) : null}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => {
            void refetch();
          }}
        >
          Retry
        </button>
      </div>
    );
  } else {
    body = (
      <>
        {isError ? (
          <div className="spectator-events-refresh-warning" role="status">
            <p>
              Couldn&apos;t refresh events. Showing previously loaded results.
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                void refetch();
              }}
            >
              Retry
            </button>
          </div>
        ) : null}
        <EventCards events={data ?? []} />
      </>
    );
  }

  return (
    <div className="app">
      <Navbar />
      <main className="spectator-events-container spectator-shell-container">
        <div className="spectator-events-header">
          <h2>Spectator</h2>
          <p>Select an event to view live scores and results.</p>
        </div>
        {body}
      </main>
    </div>
  );
}
