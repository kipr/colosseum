import React, { useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Navbar from '../components/Navbar';
import './Home.css';

export default function Home() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading } = useAuth();

  // Handle redirect after OAuth login
  useEffect(() => {
    if (searchParams.get('logged_in') === '1' && !loading) {
      // Clear the query param from URL
      window.history.replaceState({}, '', '/');

      if (user) {
        // User is logged in, redirect to admin
        navigate('/admin/events', { replace: true });
      }
    }
  }, [searchParams, user, loading, navigate]);

  const handleJudgeClick = () => {
    navigate('/judge');
  };

  const handleSpectatorClick = () => {
    navigate('/spectator');
  };

  const handleAdminClick = () => {
    if (user) {
      // Already logged in, go directly to admin
      navigate('/admin/events');
    } else {
      // Not logged in, initiate OAuth
      sessionStorage.setItem('loginIntent', 'admin');
      window.location.href = '/auth/google';
    }
  };

  return (
    <div className="app">
      <Navbar />
      <main className="container">
        <div className="hero">
          <h2>Welcome to Colosseum</h2>
          <p>A powerful tournament scoring and management platform</p>
        </div>

        <div className="role-selection">
          <div
            className="role-card role-card-clickable"
            role="button"
            tabIndex={0}
            onClick={handleJudgeClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleJudgeClick();
              }
            }}
          >
            <div className="role-icon">
              <img src="/images/botguy-red-trans-small.png" alt="Judge Icon" />
            </div>
            <h3>Judge / Scorer</h3>
            <p>
              Access scoresheets to evaluate and score participants in
              competitions or events.
            </p>
            <ul className="role-features">
              <li>✓ Fill out digital scoresheets</li>
              <li>✓ Submit scores to the tournament database</li>
              <li>✓ Multiple scoresheet templates</li>
              <li>✓ Real-time scoring</li>
            </ul>
          </div>

          <div
            className="role-card role-card-clickable"
            role="button"
            tabIndex={0}
            onClick={handleAdminClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleAdminClick();
              }
            }}
          >
            <div className="role-icon">
              <img src="/images/KIPR-Logo-bk-tiny.jpg" alt="Admin Icon" />
            </div>
            <h3>Administrator</h3>
            <p>
              Manage events, create score sheet templates, and configure
              tournaments.
            </p>
            <ul className="role-features">
              <li>✓ Create and manage events</li>
              <li>✓ Create custom score sheets</li>
              <li>✓ Review and accept submissions</li>
              <li>✓ Run brackets and seeding</li>
            </ul>
          </div>

          <div
            className="role-card role-card-clickable"
            role="button"
            tabIndex={0}
            onClick={handleSpectatorClick}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleSpectatorClick();
              }
            }}
          >
            <div className="role-icon role-icon-text">
              <span>📊</span>
            </div>
            <h3>Spectator</h3>
            <p>
              Follow along with live seeding scores, rankings, and bracket
              results for active events.
            </p>
            <ul className="role-features">
              <li>✓ View seeding scores and rankings</li>
              <li>✓ Follow bracket progress</li>
              <li>✓ No login required</li>
              <li>✓ Real-time updates</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}
