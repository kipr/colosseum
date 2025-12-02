import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import AccessCodeModal from '../components/AccessCodeModal';
import './Judge.css';

interface Template {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

export default function Judge() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<{ id: number; name: string } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      const response = await fetch('/scoresheet/templates');
      if (!response.ok) throw new Error('Failed to load templates');
      const data = await response.json();
      setTemplates(data);
    } catch (error) {
      console.error('Error loading templates:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTemplateSelect = (id: number, name: string) => {
    setSelectedTemplate({ id, name });
  };

  const handleAccessGranted = (template: any) => {
    sessionStorage.setItem('currentTemplate', JSON.stringify(template));
    const urlName = selectedTemplate!.name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    navigate(`/scoresheet?template=${selectedTemplate!.id}&name=${urlName}`);
  };

  return (
    <div className="app">
      <Navbar />
      <main className="container">
        <h2>Select a Score Sheet Template</h2>
        {loading ? (
          <p>Loading templates...</p>
        ) : templates.length === 0 ? (
          <p>No templates available. An administrator needs to create templates first.</p>
        ) : (
          <div className="template-grid">
            {templates.map(template => (
              <div
                key={template.id}
                className="template-card"
                onClick={() => handleTemplateSelect(template.id, template.name)}
              >
                <h3>{template.name}</h3>
                <p>{template.description || 'No description'}</p>
                <small>Created: {new Date(template.created_at).toLocaleDateString()}</small>
              </div>
            ))}
          </div>
        )}
      </main>

      {selectedTemplate && (
        <AccessCodeModal
          templateId={selectedTemplate.id}
          templateName={selectedTemplate.name}
          onClose={() => setSelectedTemplate(null)}
          onSuccess={handleAccessGranted}
        />
      )}
    </div>
  );
}

