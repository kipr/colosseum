/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from 'react';
import { UnifiedTable } from '../table';
import type { UnifiedColumnDef } from '../table';
import ScoreSheetEditorModal from './ScoreSheetEditorModal';
import ScoreSheetPreviewModal from './ScoreSheetPreviewModal';
import FieldTemplateModal from './FieldTemplateModal';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import { formatDate } from '../../utils/dateUtils';
import type { AdminScoreSheetSummary } from '@shared/domain/scoreSheet';
import type { FieldTemplateRow } from '@shared/domain/fieldTemplate';

export default function ScoreSheetsTab() {
  const [scoreSheets, setScoreSheets] = useState<AdminScoreSheetSummary[]>([]);
  const [fieldTemplates, setFieldTemplates] = useState<FieldTemplateRow[]>([]);
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
  const { selectedEvent } = useEvent();

  useEffect(() => {
    if (selectedEvent?.id != null) {
      loadScoreSheets(selectedEvent.id);
    } else {
      setScoreSheets([]);
    }
    loadFieldTemplates();
  }, [selectedEvent?.id]);

  const loadScoreSheets = async (eventId: number) => {
    try {
      const response = await fetch(
        `/scoresheet/templates/admin?eventId=${eventId}`,
        { credentials: 'include' },
      );
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
      if (selectedEvent?.id != null) loadScoreSheets(selectedEvent.id);
    } catch (error) {
      console.error('Error deleting score sheet:', error);
      toast.error('Failed to delete score sheet');
    }
  };

  const handleScoreSheetSaved = () => {
    setShowEditor(false);
    setEditingScoreSheet(null);
    if (selectedEvent?.id != null) loadScoreSheets(selectedEvent.id);
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

  const fieldTemplateColumns: UnifiedColumnDef<FieldTemplateRow>[] = [
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
            className="btn btn-secondary"
            onClick={() => handleEditTemplate(t.id)}
          >
            Edit
          </button>
          <button
            className="btn btn-danger"
            onClick={() => handleDeleteTemplate(t.id)}
            style={{ marginLeft: '0.5rem' }}
          >
            Delete
          </button>
        </>
      ),
    },
  ];

  const scoreSheetColumns: UnifiedColumnDef<AdminScoreSheetSummary>[] = [
    {
      kind: 'data',
      id: 'name',
      header: { full: 'Name' },
      renderCell: (s) => s.name,
    },
    {
      kind: 'data',
      id: 'description',
      header: { full: 'Description' },
      renderCell: (s) =>
        s.description || (
          <em style={{ color: 'var(--secondary-color)' }}>No description</em>
        ),
    },
    {
      kind: 'data',
      id: 'access',
      header: { full: 'Access Code' },
      renderCell: (s) => (
        <code
          style={{
            background: 'var(--bg-color)',
            padding: '0.25rem 0.5rem',
            borderRadius: '0.25rem',
          }}
        >
          {s.access_code || 'N/A'}
        </code>
      ),
    },
    {
      kind: 'data',
      id: 'created',
      header: { full: 'Created' },
      renderCell: (s) => formatDate(s.created_at),
    },
    {
      kind: 'data',
      id: 'actions',
      header: { full: 'Actions' },
      renderCell: (s) => (
        <>
          <button
            className="btn btn-primary"
            onClick={() => handlePreview(s.id)}
          >
            Preview
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => handleEdit(s.id)}
            style={{ marginLeft: '0.5rem' }}
          >
            Edit
          </button>
          <button
            className="btn btn-danger"
            onClick={() => handleDeleteScoreSheet(s.id)}
            style={{ marginLeft: '0.5rem' }}
          >
            Delete
          </button>
        </>
      ),
    },
  ];

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
            <UnifiedTable
              columns={fieldTemplateColumns}
              rows={fieldTemplates}
              getRowKey={(t) => t.id}
              headerLabelVariant="none"
            />
          )}
        </div>
      </div>

      <div className="card">
        {!selectedEvent ? (
          <p style={{ color: 'var(--secondary-color)' }}>
            Select an event to view and manage score sheets.
          </p>
        ) : (
          <>
            <button className="btn btn-primary" onClick={handleCreateNew}>
              + Create New Score Sheet
            </button>
            <div id="scoresheetsList" style={{ marginTop: '1rem' }}>
              {scoreSheets.length === 0 ? (
                <p>No score sheets for this event yet.</p>
              ) : (
                <UnifiedTable
                  columns={scoreSheetColumns}
                  rows={scoreSheets}
                  getRowKey={(s) => s.id}
                  headerLabelVariant="none"
                />
              )}
            </div>
          </>
        )}
      </div>

      {showEditor && selectedEvent && (
        <ScoreSheetEditorModal
          scoreSheetId={editingScoreSheet}
          eventId={selectedEvent.id}
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
