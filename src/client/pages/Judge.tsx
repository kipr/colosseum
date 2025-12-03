import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import AccessCodeModal from '../components/AccessCodeModal';
import { formatDate } from '../utils/dateUtils';
import './Judge.css';

interface Template {
  id: number;
  name: string;
  description: string;
  created_at: string;
  spreadsheet_config_id: number | null;
  spreadsheet_name: string | null;
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

  // Group templates by spreadsheet name
  const groupedTemplates = useMemo(() => {
    const groups: Record<string, Template[]> = {};
    
    templates.forEach(template => {
      const groupName = template.spreadsheet_name || 'Unassigned';
      if (!groups[groupName]) {
        groups[groupName] = [];
      }
      groups[groupName].push(template);
    });
    
    return groups;
  }, [templates]);

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

  // Get sorted group names (Unassigned at the end)
  const sortedGroupNames = useMemo(() => {
    const names = Object.keys(groupedTemplates);
    return names.sort((a, b) => {
      if (a === 'Unassigned') return 1;
      if (b === 'Unassigned') return -1;
      return a.localeCompare(b);
    });
  }, [groupedTemplates]);

  return (
    <div className="app">
      <Navbar />
      <main className="container">
        <h2>Select a Score Sheet</h2>
        {loading ? (
          <p>Loading templates...</p>
        ) : templates.length === 0 ? (
          <p>No scoresheets available. An administrator needs to create templates first.</p>
        ) : (
          <div className="template-groups">
            {sortedGroupNames.map(groupName => (
              <div key={groupName} className="template-group">
                <h3 className="template-group-header">{groupName}</h3>
                <div className="template-grid">
                  {groupedTemplates[groupName].map(template => (
                    <div
                      key={template.id}
                      className="template-card"
                      onClick={() => handleTemplateSelect(template.id, template.name)}
                    >
                      <h4>{template.name}</h4>
                      <p>{template.description || 'No description'}</p>
                      <small>Created: {formatDate(template.created_at)}</small>
                    </div>
                  ))}
                </div>
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

