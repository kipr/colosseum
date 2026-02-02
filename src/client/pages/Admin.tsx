import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Navbar from '../components/Navbar';
import SpreadsheetsTab from '../components/admin/SpreadsheetsTab';
import ScoreSheetsTab from '../components/admin/ScoreSheetsTab';
import ScoringTab from '../components/admin/ScoringTab';
import AdminsTab from '../components/admin/AdminsTab';
import './Admin.css';

type TabType = 'spreadsheets' | 'scoresheets' | 'scoring' | 'admins';

// Sample hardcoded events for visual mockup
const SAMPLE_EVENTS = [
  {
    id: 1,
    name: '2026 Botball Regional',
    event_date: '2026-02-14',
    location: 'San Jose, CA',
    status: 'live' as const,
    teams_count: 24,
    brackets_count: 1,
  },
  {
    id: 2,
    name: 'Practice Day',
    event_date: '2026-02-13',
    location: 'San Jose, CA',
    status: 'setup' as const,
    teams_count: 24,
    brackets_count: 0,
  },
  {
    id: 3,
    name: '2025 Fall Regional',
    event_date: '2025-10-20',
    location: 'Los Angeles, CA',
    status: 'archived' as const,
    teams_count: 32,
    brackets_count: 2,
  },
  {
    id: 4,
    name: '2025 Spring Championship',
    event_date: '2025-04-15',
    location: 'Seattle, WA',
    status: 'archived' as const,
    teams_count: 48,
    brackets_count: 3,
  },
];

type SampleEvent = (typeof SAMPLE_EVENTS)[number];

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
      (saved === 'spreadsheets' ||
        saved === 'scoresheets' ||
        saved === 'scoring' ||
        saved === 'admins')
    ) {
      return saved as TabType;
    }
    return 'spreadsheets';
  });
  const [tokenStatus, setTokenStatus] = useState<{
    valid: boolean;
    message?: string;
  } | null>(null);

  // Event selector state
  const [selectedEvent, setSelectedEvent] = useState<SampleEvent | null>(
    SAMPLE_EVENTS[0],
  );

  useEffect(() => {
    if (!loading && !user) {
      navigate('/');
    }
  }, [user, loading, navigate]);

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

  // Helper to get status badge styling
  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'live':
        return 'event-status-live';
      case 'setup':
        return 'event-status-setup';
      case 'archived':
        return 'event-status-archived';
      default:
        return '';
    }
  };

  // Format date for display
  const formatEventDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  // Render event selector dropdown at top of sidebar
  const renderEventSelector = () => (
    <div className="event-selector">
      <div className="event-selector-header">
        <span className="event-selector-label">Current Event</span>
        <button
          className="event-manage-link"
          onClick={() => alert('Would open Events management')}
        >
          Manage
        </button>
      </div>
      <select
        className="event-selector-dropdown"
        value={selectedEvent?.id || ''}
        onChange={(e) => {
          const event = SAMPLE_EVENTS.find(
            (ev) => ev.id === Number(e.target.value),
          );
          setSelectedEvent(event || null);
        }}
      >
        <option value="">Select an event...</option>
        {SAMPLE_EVENTS.map((event) => (
          <option key={event.id} value={event.id}>
            {event.name} ({event.status})
          </option>
        ))}
      </select>
      {selectedEvent && (
        <div className="event-selector-details">
          <span
            className={`event-status-badge ${getStatusBadgeClass(selectedEvent.status)}`}
          >
            {selectedEvent.status}
          </span>
          <span className="event-date">
            {formatEventDate(selectedEvent.event_date)}
          </span>
          <span className="event-location">{selectedEvent.location}</span>
        </div>
      )}
    </div>
  );

  if (loading) {
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
            {/* Event selector */}
            {renderEventSelector()}

            <div className="sidebar-menu">
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
                className={`sidebar-item ${activeTab === 'admins' ? 'active' : ''}`}
                onClick={() => setActiveTab('admins')}
              >
                👥 Admins
              </button>
            </div>
          </aside>

          <div className="admin-content">
            {/* Content header with event badge (secondary indicator) */}
            <div className="admin-content-header">
              <h2>
                {activeTab === 'spreadsheets' && 'Spreadsheets'}
                {activeTab === 'scoresheets' && 'Score Sheets'}
                {activeTab === 'scoring' && 'Scoring'}
                {activeTab === 'admins' && 'Admins'}
              </h2>
              {selectedEvent && (
                <div className="content-header-event-badge">
                  <span
                    className={`event-badge-status ${getStatusBadgeClass(selectedEvent.status)}`}
                  />
                  <span className="event-badge-name">{selectedEvent.name}</span>
                </div>
              )}
            </div>

            {activeTab === 'spreadsheets' && <SpreadsheetsTab />}
            {activeTab === 'scoresheets' && <ScoreSheetsTab />}
            {activeTab === 'scoring' && <ScoringTab />}
            {activeTab === 'admins' && <AdminsTab />}
          </div>
        </div>
      </main>
    </div>
  );
}
