import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { useEvent } from '../contexts/EventContext';
import {
  getEventStatusClass,
  getEventStatusLabel,
  formatEventDate,
} from '../utils/eventStatus';
import './Navbar.css';

function AdminEventSelector() {
  const { selectedEvent, events, selectEventById } = useEvent();

  return (
    <div className="nav-event-selector">
      <select
        className="event-dropdown"
        value={selectedEvent?.id || ''}
        onChange={(e) =>
          selectEventById(e.target.value ? Number(e.target.value) : null)
        }
      >
        <option value="">Select an event...</option>
        {events.map((event) => (
          <option key={event.id} value={event.id}>
            {event.name} ({getEventStatusLabel(event.status)})
          </option>
        ))}
      </select>
      {selectedEvent && (
        <div className="event-details-mini">
          <span
            className={`status-dot ${getEventStatusClass(selectedEvent.status)}`}
          ></span>
          {selectedEvent.event_date && (
            <span className="event-date-mini">
              {formatEventDate(selectedEvent.event_date)}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export default function Navbar() {
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

        {location.pathname === '/admin' && <AdminEventSelector />}

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
