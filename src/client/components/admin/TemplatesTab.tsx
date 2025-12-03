import React, { useEffect, useState } from 'react';
import TemplateEditorModal from './TemplateEditorModal';
import TemplatePreviewModal from './TemplatePreviewModal';
import { formatDate } from '../../utils/dateUtils';

interface Template {
  id: number;
  name: string;
  description: string;
  access_code: string;
  created_at: string;
  spreadsheet_config_id: number | null;
  spreadsheet_name: string | null;
}

export default function TemplatesTab() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<number | null>(null);
  const [previewingTemplate, setPreviewingTemplate] = useState<number | null>(null);
  const [showEditor, setShowEditor] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      const response = await fetch('/scoresheet/templates/admin', { credentials: 'include' });
      if (!response.ok) throw new Error('Failed to load templates');
      const data = await response.json();
      setTemplates(data);
    } catch (error) {
      console.error('Error loading templates:', error);
    }
  };

  const handleCreateNew = () => {
    setEditingTemplate(null);
    setShowEditor(true);
  };

  const handleEdit = (id: number) => {
    setEditingTemplate(id);
    setShowEditor(true);
  };

  const handlePreview = (id: number) => {
    setPreviewingTemplate(id);
  };

  const handleTemplateSaved = () => {
    setShowEditor(false);
    setEditingTemplate(null);
    loadTemplates();
  };

  return (
    <div>
      <h2>Score Sheet Templates</h2>

      <div className="card">
        <button className="btn btn-primary" onClick={handleCreateNew}>
          + Create New Template
        </button>
        <div id="templatesList" style={{ marginTop: '1rem' }}>
          {templates.length === 0 ? (
            <p>No templates created yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Spreadsheet</th>
                  <th>Access Code</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {templates.map(template => (
                  <tr key={template.id}>
                    <td>{template.name}</td>
                    <td>
                      {template.description || (
                        <em style={{ color: 'var(--secondary-color)' }}>No description</em>
                      )}
                    </td>
                    <td>
                      {template.spreadsheet_name || (
                        <em style={{ color: 'var(--secondary-color)' }}>Not assigned</em>
                      )}
                    </td>
                    <td>
                      <code style={{ background: 'var(--bg-color)', padding: '0.25rem 0.5rem', borderRadius: '0.25rem' }}>
                        {template.access_code || 'N/A'}
                      </code>
                    </td>
                    <td>{formatDate(template.created_at)}</td>
                    <td>
                      <button className="btn btn-primary" onClick={() => handlePreview(template.id)}>
                        Preview
                      </button>
                      <button className="btn btn-secondary" onClick={() => handleEdit(template.id)}>
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showEditor && (
        <TemplateEditorModal
          templateId={editingTemplate}
          onClose={() => {
            setShowEditor(false);
            setEditingTemplate(null);
          }}
          onSave={handleTemplateSaved}
        />
      )}

      {previewingTemplate && (
        <TemplatePreviewModal
          templateId={previewingTemplate}
          onClose={() => setPreviewingTemplate(null)}
        />
      )}
    </div>
  );
}

