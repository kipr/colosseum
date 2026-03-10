import React, { useEffect, useState, useCallback, lazy, Suspense } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEvent } from '../contexts/EventContext';
import Navbar from '../components/Navbar';
import { getEventStatusClass } from '../utils/eventStatus';
import {
  type AdminView,
  isAdminView,
  adminEventPath,
  adminEventsPath,
} from '../utils/routes';
import './Admin.css';

const EventsTab = lazy(() => import('../components/admin/EventsTab'));
const TeamsTab = lazy(() => import('../components/admin/TeamsTab'));
const ScoreSheetsTab = lazy(() => import('../components/admin/ScoreSheetsTab'));
const ScoringTab = lazy(() => import('../components/admin/ScoringTab'));
const SeedingTab = lazy(() => import('../components/admin/SeedingTab'));
const BracketsTab = lazy(() => import('../components/admin/BracketsTab'));
const QueueTab = lazy(() => import('../components/admin/QueueTab'));
const DocumentationTab = lazy(
  () => import('../components/admin/DocumentationTab'),
);
const OverallTab = lazy(() => import('../components/admin/OverallTab'));
const AdminsTab = lazy(() => import('../components/admin/AdminsTab'));
const AuditTab = lazy(() => import('../components/admin/AuditTab'));

const LOCAL_STORAGE_TAB_KEY = 'colosseum_last_admin_tab';

const TAB_LABELS: Record<AdminView, string> = {
  events: 'Manage Events',
  teams: 'Teams',
  scoresheets: 'Score Sheets',
  scoring: 'Scoring',
  seeding: 'Seeding',
  brackets: 'Brackets',
  queue: 'Queue',
  documentation: 'Documentation',
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
  brackets: '🏅',
  queue: '🎟️',
  documentation: '📚',
  overall: '📊',
  admins: '🔐',
  audit: '📋',
};

function resolveView(searchView: string | null): AdminView {
  if (isAdminView(searchView)) return searchView;

  const saved = localStorage.getItem(LOCAL_STORAGE_TAB_KEY);
  if (saved === 'templates') return 'scoresheets';
  if (isAdminView(saved)) return saved;

  return 'events';
}

export default function Admin() {
  const { user, loading } = useAuth();
  const {
    selectedEvent,
    events,
    loading: eventsLoading,
    selectEventById,
  } = useEvent();
  const navigate = useNavigate();
  const { eventId: eventIdParam, bracketId: bracketIdParam } = useParams<{
    eventId?: string;
    bracketId?: string;
  }>();
  const [searchParams] = useSearchParams();

  const activeTab: AdminView = bracketIdParam
    ? 'brackets'
    : resolveView(searchParams.get('view'));

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
        navigate(adminEventsPath('events'), { replace: true });
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

  // Keep localStorage in sync as a fallback for next visit
  useEffect(() => {
    localStorage.setItem(LOCAL_STORAGE_TAB_KEY, activeTab);
  }, [activeTab]);

  const navigateTab = useCallback(
    (view: AdminView) => {
      const eid =
        eventIdParam ?? (selectedEvent ? String(selectedEvent.id) : undefined);
      if (eid) {
        navigate(adminEventPath(eid, view));
      } else {
        navigate(adminEventsPath(view));
      }
    },
    [navigate, eventIdParam, selectedEvent],
  );

  useEffect(() => {
    if (!loading && !user) {
      navigate('/');
    }
  }, [user, loading, navigate]);

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
    window.location.href = '/auth/google';
  };

  if (loading || eventsLoading) {
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
                <button
                  key={view}
                  className={`sidebar-item ${activeTab === view ? 'active' : ''}`}
                  onClick={() => navigateTab(view)}
                >
                  {TAB_ICONS[view]} {TAB_LABELS[view]}
                </button>
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

            <Suspense
              fallback={
                <p style={{ color: 'var(--secondary-color)' }}>Loading...</p>
              }
            >
              {activeTab === 'events' && <EventsTab />}
              {activeTab === 'teams' && <TeamsTab />}
              {activeTab === 'scoresheets' && <ScoreSheetsTab />}
              {activeTab === 'scoring' && <ScoringTab />}
              {activeTab === 'seeding' && <SeedingTab />}
              {activeTab === 'brackets' && <BracketsTab />}
              {activeTab === 'queue' && <QueueTab />}
              {activeTab === 'documentation' && <DocumentationTab />}
              {activeTab === 'overall' && <OverallTab />}
              {activeTab === 'admins' && <AdminsTab />}
              {activeTab === 'audit' && (
                <AuditTab onNavigateTab={navigateTab} />
              )}
            </Suspense>
          </div>
        </div>
      </main>
    </div>
  );
}
