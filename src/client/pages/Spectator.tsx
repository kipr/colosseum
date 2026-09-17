import {
  Link,
  NavLink,
  Outlet,
  useMatches,
  useParams,
  useRouteLoaderData,
} from 'react-router-dom';
import Navbar from '../components/Navbar';
import { UnifiedTableScrollAffordanceProvider } from '../components/table';
import type { SpectatorEventLoaderData } from '../loaders/spectatorLoaders';
import {
  formatEventDate,
  getEventStatusClass,
  getEventStatusLabel,
} from '../utils/eventStatus';
import {
  spectatorBracketPath,
  spectatorEventPath,
  type SpectatorRouteHandle,
  type SpectatorView,
} from '../utils/routes';
import './SpectatorShared.css';
import './Spectator.css';
import './SpectatorTableLayout.css';

function useSpectatorView(): SpectatorView {
  const matches = useMatches();
  const match = [...matches].reverse().find((candidate) => {
    const handle = candidate.handle as
      | Partial<SpectatorRouteHandle>
      | undefined;
    return handle?.spectatorView !== undefined;
  });
  return (
    (match?.handle as SpectatorRouteHandle | undefined)?.spectatorView ??
    'seeding'
  );
}

function tabClass(active: boolean): string {
  return `spectator-tab-btn ${active ? 'active' : ''}`;
}

export default function Spectator() {
  const { event, brackets } = useRouteLoaderData(
    'spectator-event',
  ) as SpectatorEventLoaderData;
  const { bracketId } = useParams();
  const activeView = useSpectatorView();
  const selectedBracketId = bracketId ? Number(bracketId) : brackets[0]?.id;
  const bracketPath = selectedBracketId
    ? spectatorBracketPath(event.id, selectedBracketId, 'bracket')
    : spectatorEventPath(event.id, 'brackets');
  const rankingsPath = selectedBracketId
    ? spectatorBracketPath(event.id, selectedBracketId, 'rankings')
    : spectatorEventPath(event.id, 'brackets');

  return (
    <div className="app">
      <Navbar />
      <main className="spectator-container spectator-shell-container">
        <UnifiedTableScrollAffordanceProvider>
          <div className="spectator-header">
            <h2>{event.name}</h2>
            <p>View live seeding scores and bracket results.</p>
          </div>

          <div className="spectator-event-info">
            <Link className="spectator-back-btn" to="/spectator">
              ← All Events
            </Link>
            <div className="spectator-event-meta spectator-status-cluster">
              <span
                className={`event-status-badge ${getEventStatusClass(event.status)}`}
              >
                {getEventStatusLabel(event.status)}
              </span>
              {event.event_date && (
                <span>{formatEventDate(event.event_date)}</span>
              )}
              {event.location && <span>{event.location}</span>}
            </div>
          </div>

          <div className="spectator-tabs">
            <NavLink
              className={tabClass(activeView === 'seeding')}
              to={spectatorEventPath(event.id, 'seeding')}
            >
              Seeding
            </NavLink>
            {event.double_seeding_rounds > 0 && (
              <NavLink
                className={tabClass(activeView === 'double-seeding')}
                to={spectatorEventPath(event.id, 'double-seeding')}
              >
                Double Seeding
              </NavLink>
            )}
            <NavLink
              className={tabClass(activeView === 'brackets')}
              to={bracketPath}
            >
              Bracket
            </NavLink>
            {event.final_scores_available && (
              <>
                <NavLink
                  className={tabClass(activeView === 'documentation')}
                  to={spectatorEventPath(event.id, 'documentation')}
                >
                  Documentation
                </NavLink>
                <NavLink
                  className={tabClass(activeView === 'awards')}
                  to={spectatorEventPath(event.id, 'awards')}
                >
                  Awards
                </NavLink>
                {brackets.length > 0 ? (
                  <NavLink
                    className={tabClass(activeView === 'bracket-rankings')}
                    to={rankingsPath}
                  >
                    Bracket Rankings
                  </NavLink>
                ) : (
                  <span
                    className={tabClass(false)}
                    aria-disabled="true"
                    title="No brackets available"
                  >
                    Bracket Rankings
                  </span>
                )}
                <NavLink
                  className={tabClass(activeView === 'overall')}
                  to={spectatorEventPath(event.id, 'overall')}
                >
                  Overall
                </NavLink>
              </>
            )}
          </div>

          <Outlet />
        </UnifiedTableScrollAffordanceProvider>
      </main>
    </div>
  );
}
