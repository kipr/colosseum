import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEvent } from '../contexts/EventContext';
import Navbar from '../components/Navbar';
import { getEventStatusClass } from '../utils/eventStatus';
import { type AdminView, adminTabPath } from '../utils/routes';
import { useAdminRoute } from '../hooks/useAdminRoute';
import './Admin.css';

const TAB_LABELS: Record<AdminView, string> = {
  events: 'Manage Events',
  teams: 'Teams',
  scoresheets: 'Score Sheets',
  scoring: 'Scoring',
  seeding: 'Seeding',
  'double-seeding': 'Double Seeding',
  brackets: 'Brackets',
  queue: 'Queue',
  'judge-chat': 'Judge Chat',
  documentation: 'Documentation',
  awards: 'Awards',
  overall: 'Overall',
  admins: 'Admins',
  audit: 'Audit',
};

const TAB_ICONS: Record<AdminView, string> = {
  events: '📅',
  teams: '👥',
  scoresheets: '📝',
  scoring: '🏆',
  seeding: '🌱',
  'double-seeding': '🌿',
  brackets: '🏅',
  queue: '🎟️',
  'judge-chat': '💬',
  documentation: '📚',
  awards: '🏅',
  overall: '📊',
  admins: '🔐',
  audit: '📋',
};

export default function Admin() {
  const { user } = useAuth();
  const {
    selectedEvent,
    events,
    loading: eventsLoading,
    selectEventById,
  } = useEvent();
  const location = useLocation();
  const navigate = useNavigate();
  const { activeTab, eventIdParam } = useAdminRoute();

  const [tokenStatus, setTokenStatus] = useState<{
    valid: boolean;
    message?: string;
  } | null>(null);

  // Sync URL eventId to EventContext once events have loaded
  useEffect(() => {
    if (eventsLoading || events.length === 0) return;

    if (eventIdParam) {
      const id = Number(eventIdParam);
      const exists = events.find((e) => e.id === id);
      if (exists) {
        if (selectedEvent?.id !== id) selectEventById(id);
      } else {
        navigate(adminTabPath('events'), { replace: true });
      }
    }
  }, [
    eventIdParam,
    events,
    eventsLoading,
    selectedEvent?.id,
    selectEventById,
    navigate,
  ]);

  useEffect(() => {
    if (!user) return;

    const checkTokens = async () => {
      try {
        const response = await fetch('/auth/check-tokens');
        const data = await response.json();
        setTokenStatus(data);
      } catch (error) {
        console.error('Failed to check token status:', error);
      }
    };

    checkTokens();
    const interval = setInterval(checkTokens, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [user]);

  const handleReauth = () => {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    window.location.href = `/auth/google?returnTo=${encodeURIComponent(returnTo)}`;
  };

  if (eventsLoading) {
    return (
      <div className="app">
        <Navbar />
        <main className="container">
          <p>Loading...</p>
        </main>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="app">
      <Navbar />

      {tokenStatus && !tokenStatus.valid && (
        <div className="reauth-banner">
          <span>
            ⚠️ Your Google authentication has expired. Please re-authenticate to
            continue using admin features.
          </span>
          <button onClick={handleReauth} className="reauth-button">
            Re-authenticate with Google
          </button>
        </div>
      )}

      <main className="admin-container">
        <div className="admin-layout">
          <aside className="admin-sidebar">
            <div className="sidebar-menu">
              {(Object.keys(TAB_LABELS) as AdminView[]).map((view) => (
                <NavLink
                  key={view}
                  className={({ isActive }) =>
                    `sidebar-item ${isActive || activeTab === view ? 'active' : ''}`
                  }
                  to={adminTabPath(view, eventIdParam ?? selectedEvent?.id)}
                >
                  {TAB_ICONS[view]} {TAB_LABELS[view]}
                </NavLink>
              ))}
            </div>
          </aside>

          <div className="admin-content">
            <div className="admin-content-header">
              <h2>{TAB_LABELS[activeTab]}</h2>
              {selectedEvent && (
                <div className="content-header-event-badge">
                  <span
                    className={`event-badge-status ${getEventStatusClass(selectedEvent.status)}`}
                  />
                  <span className="event-badge-name">{selectedEvent.name}</span>
                </div>
              )}
            </div>

            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
