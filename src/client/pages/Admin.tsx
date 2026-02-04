import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Navbar from '../components/Navbar';
import SpreadsheetsTab from '../components/admin/SpreadsheetsTab';
import ScoreSheetsTab from '../components/admin/ScoreSheetsTab';
import ScoringTab from '../components/admin/ScoringTab';
import AdminsTab from '../components/admin/AdminsTab';
import EventsTab from '../components/admin/EventsTab';
import TeamsTab from '../components/admin/TeamsTab';
import SeedingTab from '../components/admin/SeedingTab';
import BracketsTab from '../components/admin/BracketsTab';
import QueueTab from '../components/admin/QueueTab';
import {
  Event,
  getEventStatusClass,
  isEventActive,
} from '../utils/eventStatus';
import './Admin.css';

type TabType =
  | 'events'
  | 'teams'
  | 'spreadsheets'
  | 'scoresheets'
  | 'scoring'
  | 'seeding'
  | 'brackets'
  | 'queue'
  | 'admins';

const SELECTED_EVENT_KEY = 'colosseum_selected_event_id';

export default function Admin() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    // Initialize from localStorage
    const saved = localStorage.getItem('colosseum_last_admin_tab');
    // Handle old 'templates' value
    if (saved === 'templates') {
      localStorage.setItem('colosseum_last_admin_tab', 'scoresheets');
      return 'scoresheets';
    }
    if (
      saved &&
      (saved === 'events' ||
        saved === 'teams' ||
        saved === 'spreadsheets' ||
        saved === 'scoresheets' ||
        saved === 'scoring' ||
        saved === 'seeding' ||
        saved === 'brackets' ||
        saved === 'queue' ||
        saved === 'admins')
    ) {
      return saved as TabType;
    }
    return 'events'; // Default to events now that we have it
  });
  const [tokenStatus, setTokenStatus] = useState<{
    valid: boolean;
    message?: string;
  } | null>(null);

  // Events state - fetched from API
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);

  // Fetch events from API
  const fetchEvents = useCallback(async () => {
    try {
      const response = await fetch('/events', { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Failed to fetch events');
      }
      const data: Event[] = await response.json();
      setEvents(data);

      // Restore selected event from localStorage or pick default
      const savedEventId = localStorage.getItem(SELECTED_EVENT_KEY);
      let eventToSelect: Event | null = null;

      if (savedEventId) {
        eventToSelect = data.find((e) => e.id === Number(savedEventId)) || null;
      }

      // If no saved selection or saved event not found, pick the most recent non-archived event
      if (!eventToSelect) {
        eventToSelect =
          data.find((e) => isEventActive(e.status)) || data[0] || null;
      }

      setSelectedEvent(eventToSelect);
      if (eventToSelect) {
        localStorage.setItem(SELECTED_EVENT_KEY, String(eventToSelect.id));
      }
    } catch (error) {
      console.error('Error fetching events:', error);
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/');
    }
  }, [user, loading, navigate]);

  // Fetch events when user is available
  useEffect(() => {
    if (user) {
      fetchEvents();
    }
  }, [user, fetchEvents]);

  // Save active tab to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('colosseum_last_admin_tab', activeTab);
  }, [activeTab]);

  // Check token status periodically
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

    // Check on mount
    checkTokens();

    // Check every 5 minutes
    const interval = setInterval(checkTokens, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [user]);

  const handleReauth = () => {
    window.location.href = '/auth/google';
  };

  const handleEventChange = (eventId: number) => {
    const event = events.find((ev) => ev.id === eventId) || null;
    setSelectedEvent(event);
    if (event) {
      localStorage.setItem(SELECTED_EVENT_KEY, String(event.id));
    } else {
      localStorage.removeItem(SELECTED_EVENT_KEY);
    }
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
      <Navbar
        adminEventData={{
          selectedEvent,
          onEventChange: handleEventChange,
          events,
        }}
      />

      {/* Token expiration warning banner */}
      {tokenStatus && !tokenStatus.valid && (
        <div className="reauth-banner">
          <span>
            ⚠️ Your Google authentication has expired. Please re-authenticate to
            continue using spreadsheet features.
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
              <button
                className={`sidebar-item ${activeTab === 'events' ? 'active' : ''}`}
                onClick={() => setActiveTab('events')}
              >
                📅 Events
              </button>
              <button
                className={`sidebar-item ${activeTab === 'teams' ? 'active' : ''}`}
                onClick={() => setActiveTab('teams')}
              >
                👥 Teams
              </button>
              <button
                className={`sidebar-item ${activeTab === 'spreadsheets' ? 'active' : ''}`}
                onClick={() => setActiveTab('spreadsheets')}
              >
                📊 Spreadsheets
              </button>
              <button
                className={`sidebar-item ${activeTab === 'scoresheets' ? 'active' : ''}`}
                onClick={() => setActiveTab('scoresheets')}
              >
                📝 Score Sheets
              </button>
              <button
                className={`sidebar-item ${activeTab === 'scoring' ? 'active' : ''}`}
                onClick={() => setActiveTab('scoring')}
              >
                🏆 Scoring
              </button>
              <button
                className={`sidebar-item ${activeTab === 'seeding' ? 'active' : ''}`}
                onClick={() => setActiveTab('seeding')}
              >
                🌱 Seeding
              </button>
              <button
                className={`sidebar-item ${activeTab === 'brackets' ? 'active' : ''}`}
                onClick={() => setActiveTab('brackets')}
              >
                🏅 Brackets
              </button>
              <button
                className={`sidebar-item ${activeTab === 'queue' ? 'active' : ''}`}
                onClick={() => setActiveTab('queue')}
              >
                🎟️ Queue
              </button>
              <button
                className={`sidebar-item ${activeTab === 'admins' ? 'active' : ''}`}
                onClick={() => setActiveTab('admins')}
              >
                🔐 Admins
              </button>
            </div>
          </aside>

          <div className="admin-content">
            {/* Content header with event badge (secondary indicator) */}
            <div className="admin-content-header">
              <h2>
                {activeTab === 'events' && 'Manage Events'}
                {activeTab === 'teams' && 'Teams'}
                {activeTab === 'spreadsheets' && 'Spreadsheets'}
                {activeTab === 'scoresheets' && 'Score Sheets'}
                {activeTab === 'scoring' && 'Scoring'}
                {activeTab === 'seeding' && 'Seeding'}
                {activeTab === 'brackets' && 'Brackets'}
                {activeTab === 'queue' && 'Queue'}
                {activeTab === 'admins' && 'Admins'}
              </h2>
              {selectedEvent && (
                <div className="content-header-event-badge">
                  <span
                    className={`event-badge-status ${getEventStatusClass(selectedEvent.status)}`}
                  />
                  <span className="event-badge-name">{selectedEvent.name}</span>
                </div>
              )}
            </div>

            {activeTab === 'events' && (
              <EventsTab
                events={events}
                refreshEvents={fetchEvents}
                selectedEventId={selectedEvent?.id || null}
                onSelectEvent={handleEventChange}
              />
            )}
            {activeTab === 'teams' && (
              <TeamsTab selectedEventId={selectedEvent?.id || null} />
            )}
            {activeTab === 'spreadsheets' && <SpreadsheetsTab />}
            {activeTab === 'scoresheets' && <ScoreSheetsTab />}
            {activeTab === 'scoring' && (
              <ScoringTab selectedEventId={selectedEvent?.id || null} />
            )}
            {activeTab === 'seeding' && (
              <SeedingTab
                selectedEventId={selectedEvent?.id || null}
                seedingRounds={selectedEvent?.seeding_rounds ?? 3}
              />
            )}
            {activeTab === 'brackets' && (
              <BracketsTab selectedEventId={selectedEvent?.id || null} />
            )}
            {activeTab === 'queue' && (
              <QueueTab
                selectedEventId={selectedEvent?.id || null}
                seedingRounds={selectedEvent?.seeding_rounds ?? 3}
              />
            )}
            {activeTab === 'admins' && <AdminsTab />}
          </div>
        </div>
      </main>
    </div>
  );
}
