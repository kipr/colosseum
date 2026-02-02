import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import './Navbar.css';

export interface AdminEvent {
  id: number;
  name: string;
  event_date: string;
  location: string;
  status: 'live' | 'setup' | 'archived';
  teams_count: number;
  brackets_count: number;
}

interface NavbarProps {
  adminEventData?: {
    selectedEvent: AdminEvent | null;
    onEventChange: (eventId: number) => void;
    events: AdminEvent[];
  };
}

export default function Navbar({ adminEventData }: NavbarProps) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const handleLogin = () => {
    window.location.href = '/auth/google';
  };

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

  const formatEventDate = (dateStr: string) => {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <nav className="navbar">
      <div className="nav-container">
        <div className="nav-brand">
          <Link to="/" className="brand-link">
            <h1>
              🏛️ Colosseum
              {location.pathname === '/admin'
                ? ' Admin'
                : location.pathname === '/judge'
                  ? ' - Judge'
                  : ''}
            </h1>
          </Link>
        </div>
        
        {adminEventData && (
          <div className="nav-event-selector">
            <select
              className="event-dropdown"
              value={adminEventData.selectedEvent?.id || ''}
              onChange={(e) => adminEventData.onEventChange(Number(e.target.value))}
            >
              <option value="">Select an event...</option>
              {adminEventData.events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name} ({event.status})
                </option>
              ))}
            </select>
            {adminEventData.selectedEvent && (
              <div className="event-details-mini">
                <span className={`status-dot ${getStatusBadgeClass(adminEventData.selectedEvent.status)}`}></span>
                <span className="event-date-mini">{formatEventDate(adminEventData.selectedEvent.event_date)}</span>
              </div>
            )}
          </div>
        )}

        <div className="nav-menu">
          <button className="nav-item theme-toggle" onClick={toggleTheme}>
            <span className="theme-icon">{theme === 'dark' ? '☀️' : '🌙'}</span>
            <span className="theme-label">
              {theme === 'dark' ? 'Light' : 'Dark'}
            </span>
          </button>
          {user ? (
            <>
              <button className="nav-item btn-secondary" onClick={logout}>
                Logout
              </button>
              <span className="user-info">{user.name}</span>
            </>
          ) : (
            location.pathname === '/' && (
              <button className="nav-item btn-primary" onClick={handleLogin}>
                Login with Google
              </button>
            )
          )}
        </div>
      </div>
    </nav>
  );
}
