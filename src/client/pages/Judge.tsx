/* eslint-disable @typescript-eslint/no-explicit-any */
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
  event_id?: number;
  event_name?: string;
  event_date?: string | null;
  event_status?: string;
}

export default function Judge() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTemplate, setSelectedTemplate] = useState<{
    id: number;
    name: string;
  } | null>(null);
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

  // Group templates by stable event identifier (event_id); event_name can duplicate across events
  const groupedTemplates = useMemo(() => {
    const groups: Record<string, Template[]> = {};

    templates.forEach((template) => {
      const groupKey =
        template.event_id != null ? `event-${template.event_id}` : 'unassigned';
      if (!groups[groupKey]) {
        groups[groupKey] = [];
      }
      groups[groupKey].push(template);
    });

    return groups;
  }, [templates]);

  const handleTemplateSelect = (id: number, name: string) => {
    setSelectedTemplate({ id, name });
  };

  const handleAccessGranted = (template: any) => {
    sessionStorage.setItem('currentTemplate', JSON.stringify(template));
    const urlName = selectedTemplate!.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    navigate(`/scoresheet?template=${selectedTemplate!.id}&name=${urlName}`);
  };

  // Get sorted group keys (by event date desc, then name; unassigned at end)
  const sortedGroupKeys = useMemo(() => {
    const keys = Object.keys(groupedTemplates);
    return keys.sort((a, b) => {
      if (a === 'unassigned') return 1;
      if (b === 'unassigned') return -1;
      const templateA = groupedTemplates[a][0];
      const templateB = groupedTemplates[b][0];
      const dateA = templateA?.event_date ?? '';
      const dateB = templateB?.event_date ?? '';
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      return (templateA?.event_name ?? '').localeCompare(
        templateB?.event_name ?? '',
      );
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
          <p>
            No scoresheets available. An administrator needs to create templates
            first.
          </p>
        ) : (
          <div className="template-groups">
            {sortedGroupKeys.map((groupKey) => (
              <div key={groupKey} className="template-group">
                <h3 className="template-group-header">
                  {groupKey === 'unassigned'
                    ? 'Unassigned'
                    : (groupedTemplates[groupKey][0]?.event_name ?? groupKey)}
                </h3>
                <div className="template-grid">
                  {[...groupedTemplates[groupKey]]
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map((template) => (
                      <div
                        key={template.id}
                        className="template-card"
                        onClick={() =>
                          handleTemplateSelect(template.id, template.name)
                        }
                      >
                        <h4>{template.name}</h4>
                        <p>{template.description || 'No description'}</p>
                        <small>
                          Created: {formatDate(template.created_at)}
                        </small>
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
