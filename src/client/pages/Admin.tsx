import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Navbar from '../components/Navbar';
import SpreadsheetsTab from '../components/admin/SpreadsheetsTab';
import TemplatesTab from '../components/admin/TemplatesTab';
import ScoringTab from '../components/admin/ScoringTab';
import './Admin.css';

type TabType = 'spreadsheets' | 'templates' | 'scoring';

export default function Admin() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('spreadsheets');
  const [tokenStatus, setTokenStatus] = useState<{ valid: boolean; message?: string } | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/');
    }
  }, [user, loading, navigate]);

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
          <span>⚠️ Your Google authentication has expired. Please re-authenticate to continue using spreadsheet features.</span>
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
                className={`sidebar-item ${activeTab === 'spreadsheets' ? 'active' : ''}`}
                onClick={() => setActiveTab('spreadsheets')}
              >
                📊 Spreadsheets
              </button>
              <button
                className={`sidebar-item ${activeTab === 'templates' ? 'active' : ''}`}
                onClick={() => setActiveTab('templates')}
              >
                📝 Templates
              </button>
              <button
                className={`sidebar-item ${activeTab === 'scoring' ? 'active' : ''}`}
                onClick={() => setActiveTab('scoring')}
              >
                🏆 Scoring
              </button>
            </div>
          </aside>

          <div className="admin-content">
            {activeTab === 'spreadsheets' && <SpreadsheetsTab />}
            {activeTab === 'templates' && <TemplatesTab />}
            {activeTab === 'scoring' && <ScoringTab />}
          </div>
        </div>
      </main>
    </div>
  );
}

