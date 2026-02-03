import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import {
  Event,
  getEventStatusClass,
  getEventStatusLabel,
  formatEventDate,
} from '../utils/eventStatus';
import './Navbar.css';

interface NavbarProps {
  adminEventData?: {
    selectedEvent: Event | null;
    onEventChange: (eventId: number) => void;
    events: Event[];
  };
}

export default function Navbar({ adminEventData }: NavbarProps) {
  const location = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const handleLogin = () => {
    window.location.href = '/auth/google';
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
              onChange={(e) =>
                adminEventData.onEventChange(Number(e.target.value))
              }
            >
              <option value="">Select an event...</option>
              {adminEventData.events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.name} ({getEventStatusLabel(event.status)})
                </option>
              ))}
            </select>
            {adminEventData.selectedEvent && (
              <div className="event-details-mini">
                <span
                  className={`status-dot ${getEventStatusClass(adminEventData.selectedEvent.status)}`}
                ></span>
                {adminEventData.selectedEvent.event_date && (
                  <span className="event-date-mini">
                    {formatEventDate(adminEventData.selectedEvent.event_date)}
                  </span>
                )}
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
