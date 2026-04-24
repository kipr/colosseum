/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import AccessCodeModal from '../components/AccessCodeModal';
import { formatDate } from '../utils/dateUtils';
import type {
  ScoresheetTemplateForJudges,
  ScoresheetTemplateForJudgesResponse,
} from '../../shared/api';
import './Judge.css';

type Template = ScoresheetTemplateForJudges;

interface TemplateGroup {
  readonly eventId: number;
  readonly eventName: string;
  readonly eventDate: string | null;
  readonly templates: readonly Template[];
}

export default function Judge() {
  const [templates, setTemplates] = useState<readonly Template[]>([]);
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
      const data: ScoresheetTemplateForJudgesResponse = await response.json();
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
    const urlName = selectedTemplate!.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    navigate(`/scoresheet?template=${selectedTemplate!.id}&name=${urlName}`);
  };

  // Group templates by stable event_id (event_name can duplicate across
  // events) and sort each group + the group list itself in a single pass:
  // groups by event date desc then event name; templates within a group
  // by name. Every visible template is linked to a setup/active event,
  // so there is no "unassigned" bucket.
  const templateGroups = useMemo<readonly TemplateGroup[]>(() => {
    const byEvent = new Map<number, Template[]>();
    for (const template of templates) {
      const bucket = byEvent.get(template.event_id);
      if (bucket) {
        bucket.push(template);
      } else {
        byEvent.set(template.event_id, [template]);
      }
    }
    return Array.from(byEvent.values())
      .map((bucket): TemplateGroup => {
        const head = bucket[0];
        return {
          eventId: head.event_id,
          eventName: head.event_name,
          eventDate: head.event_date,
          templates: [...bucket].sort((a, b) => a.name.localeCompare(b.name)),
        };
      })
      .sort((a, b) => {
        const dateA = a.eventDate ?? '';
        const dateB = b.eventDate ?? '';
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        return a.eventName.localeCompare(b.eventName);
      });
  }, [templates]);

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
            {templateGroups.map((group) => (
              <div key={group.eventId} className="template-group">
                <h3 className="template-group-header">{group.eventName}</h3>
                <div className="template-grid">
                  {group.templates.map((template) => (
                    <div
                      key={template.id}
                      className="template-card"
                      onClick={() =>
                        handleTemplateSelect(template.id, template.name)
                      }
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
