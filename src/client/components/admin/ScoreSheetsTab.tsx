import React, { useEffect, useState } from 'react';
import ScoreSheetEditorModal from './ScoreSheetEditorModal';
import ScoreSheetPreviewModal from './ScoreSheetPreviewModal';
import FieldTemplateModal from './FieldTemplateModal';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { formatDate } from '../../utils/dateUtils';

interface ScoreSheet {
  id: number;
  name: string;
  description: string;
  access_code: string;
  created_at: string;
  spreadsheet_config_id: number | null;
  spreadsheet_name: string | null;
}

interface FieldTemplate {
  id: number;
  name: string;
  description: string;
  created_at: string;
}

export default function ScoreSheetsTab() {
  const [scoreSheets, setScoreSheets] = useState<ScoreSheet[]>([]);
  const [fieldTemplates, setFieldTemplates] = useState<FieldTemplate[]>([]);
  const [editingScoreSheet, setEditingScoreSheet] = useState<number | null>(
    null,
  );
  const [previewingScoreSheet, setPreviewingScoreSheet] = useState<
    number | null
  >(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<number | null>(null);
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);

  const { confirm, ConfirmDialog } = useConfirm();
  const toast = useToast();

  useEffect(() => {
    loadScoreSheets();
    loadFieldTemplates();
  }, []);

  const loadScoreSheets = async () => {
    try {
      const response = await fetch('/scoresheet/templates/admin', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to load score sheets');
      const data = await response.json();
      setScoreSheets(data);
    } catch (error) {
      console.error('Error loading score sheets:', error);
    }
  };

  const loadFieldTemplates = async () => {
    try {
      const response = await fetch('/field-templates', {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(`Failed to load field templates: ${response.status}`);
      }

      const data = await response.json();
      setFieldTemplates(data);
    } catch (error: any) {
      console.error('Error loading field templates:', error.message || error);
      setFieldTemplates([]);
    }
  };

  const handleCreateNew = () => {
    setEditingScoreSheet(null);
    setShowEditor(true);
  };

  const handleEdit = (id: number) => {
    setEditingScoreSheet(id);
    setShowEditor(true);
  };

  const handlePreview = (id: number) => {
    setPreviewingScoreSheet(id);
  };

  const handleDeleteScoreSheet = async (id: number) => {
    const confirmed = await confirm({
      title: 'Delete Score Sheet',
      message:
        'Are you sure you want to delete this score sheet? This cannot be undone.',
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;

    try {
      const response = await fetch(`/scoresheet/templates/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete score sheet');
      loadScoreSheets();
    } catch (error) {
      console.error('Error deleting score sheet:', error);
      toast.error('Failed to delete score sheet');
    }
  };

  const handleScoreSheetSaved = () => {
    setShowEditor(false);
    setEditingScoreSheet(null);
    loadScoreSheets();
  };

  const handleCreateTemplate = () => {
    setEditingTemplate(null);
    setShowTemplateEditor(true);
  };

  const handleEditTemplate = (id: number) => {
    setEditingTemplate(id);
    setShowTemplateEditor(true);
  };

  const handleDeleteTemplate = async (id: number) => {
    const confirmed = await confirm({
      title: 'Delete Field Template',
      message: 'Are you sure you want to delete this field template?',
      confirmText: 'Delete',
      confirmStyle: 'danger',
    });
    if (!confirmed) return;

    try {
      const response = await fetch(`/field-templates/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete template');
      loadFieldTemplates();
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('Failed to delete template');
    }
  };

  const handleTemplateSaved = () => {
    setShowTemplateEditor(false);
    setEditingTemplate(null);
    loadFieldTemplates();
  };

  return (
    <div>
      <h2>Score Sheets</h2>

      {/* Field Templates Section */}
      <div className="card" style={{ marginBottom: '2rem' }}>
        <h3>Scoring Field Templates</h3>
        <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
          Create reusable scoring field patterns that work for both seeding and
          DE score sheets. These can be selected in the wizard to quickly
          generate score sheets.
        </p>

        <button className="btn btn-primary" onClick={handleCreateTemplate}>
          + Create Field Template
        </button>

        <div style={{ marginTop: '1rem' }}>
          {fieldTemplates.length === 0 ? (
            <p style={{ color: 'var(--secondary-color)' }}>
              No field templates created yet.
            </p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {fieldTemplates.map((template) => (
                  <tr key={template.id}>
                    <td>{template.name}</td>
                    <td>
                      {template.description || (
                        <em style={{ color: 'var(--secondary-color)' }}>
                          No description
                        </em>
                      )}
                    </td>
                    <td>{formatDate(template.created_at)}</td>
                    <td>
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleEditTemplate(template.id)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDeleteTemplate(template.id)}
                        style={{ marginLeft: '0.5rem' }}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <button className="btn btn-primary" onClick={handleCreateNew}>
          + Create New Score Sheet
        </button>
        <div id="scoresheetsList" style={{ marginTop: '1rem' }}>
          {scoreSheets.length === 0 ? (
            <p>No score sheets created yet.</p>
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
                {scoreSheets.map((sheet) => (
                  <tr key={sheet.id}>
                    <td>{sheet.name}</td>
                    <td>
                      {sheet.description || (
                        <em style={{ color: 'var(--secondary-color)' }}>
                          No description
                        </em>
                      )}
                    </td>
                    <td>
                      {sheet.spreadsheet_name || (
                        <em style={{ color: 'var(--secondary-color)' }}>
                          Not assigned
                        </em>
                      )}
                    </td>
                    <td>
                      <code
                        style={{
                          background: 'var(--bg-color)',
                          padding: '0.25rem 0.5rem',
                          borderRadius: '0.25rem',
                        }}
                      >
                        {sheet.access_code || 'N/A'}
                      </code>
                    </td>
                    <td>{formatDate(sheet.created_at)}</td>
                    <td>
                      <button
                        className="btn btn-primary"
                        onClick={() => handlePreview(sheet.id)}
                      >
                        Preview
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() => handleEdit(sheet.id)}
                        style={{ marginLeft: '0.5rem' }}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => handleDeleteScoreSheet(sheet.id)}
                        style={{ marginLeft: '0.5rem' }}
                      >
                        Delete
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
        <ScoreSheetEditorModal
          scoreSheetId={editingScoreSheet}
          onClose={() => {
            setShowEditor(false);
            setEditingScoreSheet(null);
          }}
          onSave={handleScoreSheetSaved}
        />
      )}

      {previewingScoreSheet && (
        <ScoreSheetPreviewModal
          scoreSheetId={previewingScoreSheet}
          onClose={() => setPreviewingScoreSheet(null)}
        />
      )}

      {showTemplateEditor && (
        <FieldTemplateModal
          templateId={editingTemplate}
          onClose={() => {
            setShowTemplateEditor(false);
            setEditingTemplate(null);
          }}
          onSave={handleTemplateSaved}
        />
      )}

      {ConfirmDialog}
      {toast.ToastContainer}
    </div>
  );
}
