import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import ScoresheetForm from '../components/ScoresheetForm';
import './Scoresheet.css';

export default function Scoresheet() {
  const [template, setTemplate] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const navigate = useNavigate();

  const loadTemplate = useCallback(() => {
    try {
      const templateData = sessionStorage.getItem('currentTemplate');
      
      if (!templateData) {
        setError(true);
        setLoading(false);
        return;
      }

      const parsedTemplate = JSON.parse(templateData);
      
      // Validate template has required structure
      if (!parsedTemplate.schema || !parsedTemplate.schema.fields) {
        console.error('Invalid template structure');
        setError(true);
        setLoading(false);
        return;
      }
      
      setTemplate(parsedTemplate);
      setError(false);
    } catch (err) {
      console.error('Error parsing template:', err);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTemplate();
  }, [loadTemplate, retryCount]);
  
  // Handle retry with fresh state
  const handleRetry = () => {
    setLoading(true);
    setError(false);
    setTemplate(null);
    setRetryCount(prev => prev + 1);
  };
  
  // Force reload the page to clear any stale state
  const handleForceReload = () => {
    window.location.reload();
  };

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
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button className="btn btn-primary" onClick={handleRetry}>
              Retry
            </button>
            <button className="btn btn-secondary" onClick={handleForceReload}>
              Force Reload Page
            </button>
            <button className="btn btn-secondary" onClick={() => navigate('/judge')}>
              Back to Templates
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <Navbar />
      <main className="container">
        {/* Use key with retryCount to force fresh component state on retry */}
        <ScoresheetForm key={`scoresheet-${template.id}-${retryCount}`} template={template} />
      </main>
    </div>
  );
}

