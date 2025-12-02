import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Navbar from '../components/Navbar';
import SpreadsheetsTab from '../components/admin/SpreadsheetsTab';
import TemplatesTab from '../components/admin/TemplatesTab';
import HistoryTab from '../components/admin/HistoryTab';
import './Admin.css';

type TabType = 'spreadsheets' | 'templates' | 'history';

export default function Admin() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabType>('spreadsheets');

  useEffect(() => {
    if (!loading && !user) {
      navigate('/');
    }
  }, [user, loading, navigate]);

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
                className={`sidebar-item ${activeTab === 'history' ? 'active' : ''}`}
                onClick={() => setActiveTab('history')}
              >
                📜 Score History
              </button>
            </div>
          </aside>

          <div className="admin-content">
            {activeTab === 'spreadsheets' && <SpreadsheetsTab />}
            {activeTab === 'templates' && <TemplatesTab />}
            {activeTab === 'history' && <HistoryTab />}
          </div>
        </div>
      </main>
    </div>
  );
}

