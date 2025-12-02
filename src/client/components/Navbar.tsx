import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import './Navbar.css';

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();

  const isActive = (path: string) => location.pathname === path;

  const handleLogin = () => {
    window.location.href = '/auth/google';
  };

  return (
    <nav className="navbar">
      <div className="nav-container">
        <div className="nav-brand">
          <h1>🏛️ Colosseum{location.pathname === '/admin' ? ' Admin' : location.pathname === '/judge' ? ' - Judge' : ''}</h1>
        </div>
        <div className="nav-menu">
          <button className="nav-item" onClick={() => navigate('/')}>
            Home
          </button>
          {user && (
            <button className={`nav-item ${isActive('/admin') ? 'active' : ''}`} onClick={() => navigate('/admin')}>
              Admin
            </button>
          )}
          <button className="nav-item theme-toggle" onClick={toggleTheme}>
            <span className="theme-icon">{theme === 'dark' ? '☀️' : '🌙'}</span>
            <span className="theme-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
          </button>
          {user ? (
            <>
              <button className="nav-item btn-secondary" onClick={logout}>
                Logout
              </button>
              <span className="user-info">{user.name}</span>
            </>
          ) : location.pathname === '/' && (
            <button className="nav-item btn-primary" onClick={handleLogin}>
              Login with Google
            </button>
          )}
        </div>
      </div>
    </nav>
  );
}

