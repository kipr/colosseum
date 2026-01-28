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
        navigate('/admin', { replace: true });
      }
    }
  }, [searchParams, user, loading, navigate]);

  const handleJudgeClick = () => {
    navigate('/judge');
  };

  const handleAdminClick = () => {
    if (user) {
      // Already logged in, go directly to admin
      navigate('/admin');
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
          <p>A powerful scoring application with Google Sheets integration</p>
        </div>

        <div className="role-selection">
          <div className="role-card">
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
              <li>✓ Submit scores directly to spreadsheets</li>
              <li>✓ Multiple scoresheet templates</li>
              <li>✓ Real-time scoring</li>
            </ul>
            <button
              className="btn btn-primary btn-large"
              onClick={handleJudgeClick}
            >
              Enter as Judge
            </button>
          </div>

          <div className="role-card">
            <div className="role-icon">
              <img src="/images/KIPR-Logo-bk-tiny.jpg" alt="Admin Icon" />
            </div>
            <h3>Administrator</h3>
            <p>
              Manage spreadsheets, create scoresheet templates, and configure
              the application.
            </p>
            <ul className="role-features">
              <li>✓ Link Google Spreadsheets</li>
              <li>✓ Create custom templates</li>
              <li>✓ View submission history</li>
              <li>✓ Manage configurations</li>
            </ul>
            <button
              className="btn btn-secondary btn-large"
              onClick={handleAdminClick}
            >
              {user ? 'Go to Admin' : 'Login as Admin'}
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
