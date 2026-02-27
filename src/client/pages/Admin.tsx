import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useEvent } from '../contexts/EventContext';
import Navbar from '../components/Navbar';
import ScoreSheetsTab from '../components/admin/ScoreSheetsTab';
import ScoringTab from '../components/admin/ScoringTab';
import AdminsTab from '../components/admin/AdminsTab';
import EventsTab from '../components/admin/EventsTab';
import TeamsTab from '../components/admin/TeamsTab';
import SeedingTab from '../components/admin/SeedingTab';
import BracketsTab from '../components/admin/BracketsTab';
import QueueTab from '../components/admin/QueueTab';
import AuditTab from '../components/admin/AuditTab';
import DocumentationTab from '../components/admin/DocumentationTab';
import { getEventStatusClass } from '../utils/eventStatus';
import './Admin.css';

type TabType =
  | 'events'
  | 'teams'
  | 'scoresheets'
  | 'scoring'
  | 'seeding'
  | 'brackets'
  | 'queue'
  | 'documentation'
  | 'admins'
  | 'audit';

export default function Admin() {
  const { user, loading } = useAuth();
  const { selectedEvent, loading: eventsLoading } = useEvent();
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
        saved === 'scoresheets' ||
        saved === 'scoring' ||
        saved === 'seeding' ||
        saved === 'brackets' ||
        saved === 'queue' ||
        saved === 'documentation' ||
        saved === 'admins' ||
        saved === 'audit')
    ) {
      return saved as TabType;
    }
    return 'events'; // Default to events now that we have it
  });
  const [tokenStatus, setTokenStatus] = useState<{
    valid: boolean;
    message?: string;
  } | null>(null);

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

      {/* Token expiration warning banner */}
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
                className={`sidebar-item ${activeTab === 'documentation' ? 'active' : ''}`}
                onClick={() => setActiveTab('documentation')}
              >
                📚 Documentation
              </button>
              <button
                className={`sidebar-item ${activeTab === 'admins' ? 'active' : ''}`}
                onClick={() => setActiveTab('admins')}
              >
                🔐 Admins
              </button>
              <button
                className={`sidebar-item ${activeTab === 'audit' ? 'active' : ''}`}
                onClick={() => setActiveTab('audit')}
              >
                📋 Audit
              </button>
            </div>
          </aside>

          <div className="admin-content">
            {/* Content header with event badge (secondary indicator) */}
            <div className="admin-content-header">
              <h2>
                {activeTab === 'events' && 'Manage Events'}
                {activeTab === 'teams' && 'Teams'}
                {activeTab === 'scoresheets' && 'Score Sheets'}
                {activeTab === 'scoring' && 'Scoring'}
                {activeTab === 'seeding' && 'Seeding'}
                {activeTab === 'brackets' && 'Brackets'}
                {activeTab === 'queue' && 'Queue'}
                {activeTab === 'documentation' && 'Documentation'}
                {activeTab === 'admins' && 'Admins'}
                {activeTab === 'audit' && 'Audit'}
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

            {activeTab === 'events' && <EventsTab />}
            {activeTab === 'teams' && <TeamsTab />}
            {activeTab === 'scoresheets' && <ScoreSheetsTab />}
            {activeTab === 'scoring' && <ScoringTab />}
            {activeTab === 'seeding' && <SeedingTab />}
            {activeTab === 'brackets' && <BracketsTab />}
            {activeTab === 'queue' && <QueueTab />}
            {activeTab === 'documentation' && <DocumentationTab />}
            {activeTab === 'admins' && <AdminsTab />}
            {activeTab === 'audit' && <AuditTab onNavigateTab={setActiveTab} />}
          </div>
        </div>
      </main>
    </div>
  );
}
