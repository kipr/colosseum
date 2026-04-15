import React, { useEffect, useState } from 'react';
import { UnifiedTable } from '../table';
import type { UnifiedColumnDef } from '../table';
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
  const [previewingTemplate, setPreviewingTemplate] = useState<number | null>(
    null,
  );
  const [showEditor, setShowEditor] = useState(false);

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    try {
      const response = await fetch('/scoresheet/templates/admin', {
        credentials: 'include',
      });
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

  const templateColumns: UnifiedColumnDef<Template>[] = [
    {
      kind: 'data',
      id: 'name',
      header: { full: 'Name' },
      renderCell: (t) => t.name,
    },
    {
      kind: 'data',
      id: 'description',
      header: { full: 'Description' },
      renderCell: (t) =>
        t.description || (
          <em style={{ color: 'var(--secondary-color)' }}>No description</em>
        ),
    },
    {
      kind: 'data',
      id: 'spreadsheet',
      header: { full: 'Spreadsheet' },
      renderCell: (t) =>
        t.spreadsheet_name || (
          <em style={{ color: 'var(--secondary-color)' }}>Not assigned</em>
        ),
    },
    {
      kind: 'data',
      id: 'access',
      header: { full: 'Access Code' },
      renderCell: (t) => (
        <code
          style={{
            background: 'var(--bg-color)',
            padding: '0.25rem 0.5rem',
            borderRadius: '0.25rem',
          }}
        >
          {t.access_code || 'N/A'}
        </code>
      ),
    },
    {
      kind: 'data',
      id: 'created',
      header: { full: 'Created' },
      renderCell: (t) => formatDate(t.created_at),
    },
    {
      kind: 'data',
      id: 'actions',
      header: { full: 'Actions' },
      renderCell: (t) => (
        <>
          <button
            className="btn btn-primary"
            onClick={() => handlePreview(t.id)}
          >
            Preview
          </button>
          <button
            className="btn btn-secondary"
            style={{ marginLeft: '0.5rem' }}
            onClick={() => handleEdit(t.id)}
          >
            Edit
          </button>
        </>
      ),
    },
  ];

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
            <UnifiedTable
              columns={templateColumns}
              rows={templates}
              getRowKey={(t) => t.id}
              headerLabelVariant="none"
            />
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
