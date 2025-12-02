import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import ScoresheetForm from '../components/ScoresheetForm';
import './Scoresheet.css';

export default function Scoresheet() {
  const [template, setTemplate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const templateData = sessionStorage.getItem('currentTemplate');
    
    if (!templateData) {
      setError(true);
      setLoading(false);
      return;
    }

    try {
      const parsedTemplate = JSON.parse(templateData);
      setTemplate(parsedTemplate);
    } catch (err) {
      console.error('Error parsing template:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  if (loading) {
    return (
      <div className="app">
        <Navbar />
        <main className="container">
          <p>Loading scoresheet...</p>
        </main>
      </div>
    );
  }

  if (error || !template) {
    return (
      <div className="app">
        <Navbar />
        <main className="container">
          <p style={{ color: 'var(--danger-color)' }}>
            Failed to load scoresheet. Please try again.
          </p>
          <button className="btn btn-secondary" onClick={() => navigate('/judge')}>
            Back to Templates
          </button>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <Navbar />
      <main className="container">
        <ScoresheetForm template={template} />
      </main>
    </div>
  );
}

