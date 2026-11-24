import { NavLink } from 'react-router-dom';
import Navbar from '../Navbar';
import { useScopedLoad } from '../../hooks/useScopedLoad';
import { apiFetch } from '../../utils/api';
import type { SpectatorListing } from '../../utils/eventStatus';
import { spectatorArchivePath, spectatorEventsPath } from '../../utils/routes';
import {
  getSpectatorEvents,
  groupArchiveEvents,
  type PublicEvent,
} from '../../utils/spectatorEvents';
import SpectatorEventCard from './SpectatorEventCard';
import '../../pages/SpectatorShared.css';
import '../../pages/SpectatorEvents.css';

interface ListingResult {
  events: PublicEvent[];
  failed: boolean;
}

export default function SpectatorEventListing({
  listing,
}: {
  listing: SpectatorListing;
}) {
  const archive = listing === 'archive';
  const { data, loading, reload } = useScopedLoad<
    SpectatorListing,
    ListingResult
  >(
    listing,
    async (placement, signal) => {
      try {
        const events = await apiFetch<PublicEvent[]>(
          placement === 'archive'
            ? '/events/public?listing=archive'
            : '/events/public',
          {
            signal,
            cache: 'no-cache',
            fallbackError: 'Failed to fetch events',
          },
        );
        return { events, failed: false };
      } catch {
        // Keep failures in the scoped result so late errors cannot cross lists.
        return { events: [], failed: true };
      }
    },
    { initial: { events: [], failed: false } },
  );
  const seasons = archive ? groupArchiveEvents(data.events) : [];
  const events = archive ? [] : getSpectatorEvents(data.events, 'current');
  const empty = archive ? seasons.length === 0 : events.length === 0;

  return (
    <div className="app">
      <Navbar />
      <main className="spectator-events-container spectator-shell-container">
        <div className="spectator-events-header">
          <h2>{archive ? 'Spectator Archive' : 'Spectator'}</h2>
          <p>
            {archive
              ? 'Browse archived events by season.'
              : 'Select an event to view live scores and results.'}
          </p>
        </div>

        <nav className="spectator-listing-nav" aria-label="Spectator listings">
          <NavLink to={spectatorEventsPath()} end>
            Current Events
          </NavLink>
          <NavLink to={spectatorArchivePath()} end>
            Archive
          </NavLink>
        </nav>

        {loading ? (
          <p role="status">
            {archive ? 'Loading archive...' : 'Loading events...'}
          </p>
        ) : data.failed ? (
          <div className="card" role="alert">
            <p>
              {archive
                ? 'Could not load archive events.'
                : 'Could not load current events.'}
            </p>
            <button className="btn btn-primary" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        ) : empty ? (
          <div className="card">
            <p className="spectator-muted-message">
              {archive
                ? 'No archived events are currently available.'
                : 'No events are currently available.'}
            </p>
          </div>
        ) : archive ? (
          seasons.map((season) => (
            <section
              key={season.id}
              className="spectator-archive-season"
              aria-labelledby={`spectator-season-${season.id}`}
            >
              <h3 id={`spectator-season-${season.id}`}>{season.name}</h3>
              <div className="spectator-events-grid">
                {season.events.map((event) => (
                  <SpectatorEventCard
                    key={event.id}
                    event={event}
                    headingLevel={4}
                  />
                ))}
              </div>
            </section>
          ))
        ) : (
          <div className="spectator-events-grid">
            {events.map((event) => (
              <SpectatorEventCard key={event.id} event={event} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
