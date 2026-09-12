import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import {
  templatesQueryOptions,
  fieldTemplatesQueryOptions,
  useTemplateMutations,
} from '../../queries/templates';
import type {
  TemplateSummary as ScoreSheet,
  FieldTemplate,
} from '../../api/templates';
import QueryFeedback, { queryData } from '../QueryFeedback';
import { useState } from 'react';
import { UnifiedTable } from '../table';
import type { UnifiedColumnDef } from '../table';
import ScoreSheetEditorModal from './ScoreSheetEditorModal';
import TemplatePreviewModal from './TemplatePreviewModal';
import FieldTemplateModal from './FieldTemplateModal';
import { useConfirm } from '../ConfirmModal';
import { useToast } from '../Toast';
import { useEvent } from '../../contexts/EventContext';
import { formatDate } from '../../utils/dateUtils';

export default function ScoreSheetsTab() {
  const { user, loading } = useAuth();
  const { remove, removeField } = useTemplateMutations();
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

  const sheetsQuery = useQuery({
    ...templatesQueryOptions(user?.id ?? 0, selectedEvent?.id),
    enabled: Boolean(user?.isAdmin && !loading && selectedEvent),
  });
  const fieldsQuery = useQuery({
    ...fieldTemplatesQueryOptions(user?.id ?? 0),
    enabled: Boolean(user && !loading),
  });
  const scoreSheets = user?.isAdmin ? (queryData(sheetsQuery) ?? []) : [];
  const fieldTemplates = queryData(fieldsQuery) ?? [];

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
      if (!user?.isAdmin || remove.isPending) return;
      await remove.mutateAsync({ userId: user.id, templateId: id });
    } catch (error) {
      console.error('Error deleting score sheet:', error);
      toast.error('Failed to delete score sheet');
    }
  };

  const handleScoreSheetSaved = (message: string) => {
    toast.success(message);
    setShowEditor(false);
    setEditingScoreSheet(null);
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
      if (!user || removeField.isPending) return;
      await removeField.mutateAsync({ userId: user.id, templateId: id });
    } catch (error) {
      console.error('Error deleting template:', error);
      toast.error('Failed to delete template');
    }
  };

  const handleTemplateSaved = (message: string) => {
    toast.success(message);
    setShowTemplateEditor(false);
    setEditingTemplate(null);
  };

  const fieldTemplateColumns: UnifiedColumnDef<FieldTemplate>[] = [
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

  const scoreSheetColumns: UnifiedColumnDef<ScoreSheet>[] = [
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
        <QueryFeedback query={fieldsQuery} />
        <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
          Create reusable scoring field patterns that work for both seeding and
          DE score sheets. These can be selected in the wizard to quickly
          generate score sheets.
        </p>

        <button className="btn btn-primary" onClick={handleCreateTemplate}>
          + Create Field Template
        </button>

        <div style={{ marginTop: '1rem' }}>
          {fieldsQuery.isLoading ||
          (fieldsQuery.isError &&
            !queryData(fieldsQuery)) ? null : fieldTemplates.length === 0 ? (
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
        {!user?.isAdmin ? (
          <p>Admin access is required to manage score sheets.</p>
        ) : !selectedEvent ? (
          <p style={{ color: 'var(--secondary-color)' }}>
            Select an event to view and manage score sheets.
          </p>
        ) : (
          <>
            <button className="btn btn-primary" onClick={handleCreateNew}>
              + Create New Score Sheet
            </button>
            <div id="scoresheetsList" style={{ marginTop: '1rem' }}>
              <QueryFeedback query={sheetsQuery} />
              {sheetsQuery.isLoading ||
              (sheetsQuery.isError &&
                !queryData(sheetsQuery)) ? null : scoreSheets.length === 0 ? (
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
          key={`${user?.id}-${selectedEvent.id}-${editingScoreSheet ?? 'new'}`}
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
        <TemplatePreviewModal
          key={`${user?.id}-${previewingScoreSheet}`}
          templateId={previewingScoreSheet}
          onClose={() => setPreviewingScoreSheet(null)}
        />
      )}

      {showTemplateEditor && (
        <FieldTemplateModal
          key={`${user?.id}-${editingTemplate ?? 'new'}`}
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
