import { Link } from 'react-router-dom';
import {
  formatEventDate,
  getEventStatusClass,
  getEventStatusLabel,
} from '../../utils/eventStatus';
import { spectatorEventPath } from '../../utils/routes';
import type { PublicEvent } from '../../utils/spectatorEvents';

interface SpectatorEventCardProps {
  event: PublicEvent;
  headingLevel?: 3 | 4;
}

export default function SpectatorEventCard({
  event,
  headingLevel = 3,
}: SpectatorEventCardProps) {
  const Heading = headingLevel === 4 ? 'h4' : 'h3';
  return (
    <Link
      to={spectatorEventPath(event.id, 'seeding')}
      className="spectator-event-card"
    >
      <div className="spectator-event-card-header spectator-status-cluster">
        <span
          className={`event-status-badge ${getEventStatusClass(event.status)}`}
        >
          {getEventStatusLabel(event.status)}
        </span>
      </div>
      <Heading>{event.name}</Heading>
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
    </Link>
  );
}
