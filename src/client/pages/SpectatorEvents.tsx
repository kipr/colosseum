import { Link, useLoaderData } from 'react-router-dom';
import Navbar from '../components/Navbar';
import type { PublicEvent } from '../loaders/spectatorLoaders';
import {
  formatEventDate,
  getEventStatusClass,
  getEventStatusLabel,
} from '../utils/eventStatus';
import { spectatorEventPath } from '../utils/routes';
import './SpectatorShared.css';
import './SpectatorEvents.css';

export default function SpectatorEvents() {
  const events = useLoaderData() as PublicEvent[];

  return (
    <div className="app">
      <Navbar />
      <main className="spectator-events-container spectator-shell-container">
        <div className="spectator-events-header">
          <h2>Spectator</h2>
          <p>Select an event to view live scores and results.</p>
        </div>

        {events.length === 0 ? (
          <div className="card">
            <p className="spectator-muted-message">
              No events are currently available.
            </p>
          </div>
        ) : (
          <div className="spectator-events-grid">
            {events.map((event) => (
              <Link
                key={event.id}
                className="spectator-event-card"
                to={spectatorEventPath(event.id, 'seeding')}
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
                      <span aria-hidden>📅</span>{' '}
                      {formatEventDate(event.event_date)}
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
              </Link>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
