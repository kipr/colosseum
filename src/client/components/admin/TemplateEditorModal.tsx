import type { Bracket } from '../../types/brackets';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import {
  templateQueryOptions,
  useTemplateMutations,
} from '../../queries/templates';
import { bracketsQueryOptions } from '../../queries/brackets';
import QueryFeedback, { queryData } from '../QueryFeedback';
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState } from 'react';
import {
  getBracketSourceEventId,
  isEventScopedBracketSource,
} from '../scoresheetUtils';
import '../Modal.css';

interface TemplateEditorModalProps {
  templateId: number | null;
  eventId: number;
  onClose: () => void;
  onSave: (message: string) => void;
  initialData?: {
    name: string;
    description: string;
    accessCode: string;
    schema: any;
  };
}

export default function TemplateEditorModal(props: TemplateEditorModalProps) {
  const { user, loading } = useAuth();
  const query = useQuery({
    ...templateQueryOptions(
      user?.id ?? 0,
      props.templateId ?? 0,
      Boolean(user?.isAdmin),
    ),
    enabled: Boolean(user?.isAdmin && !loading && props.templateId),
  });
  const bracketsQuery = useQuery({
    ...bracketsQueryOptions(user?.id ?? 0, props.eventId),
    enabled: Boolean(user?.isAdmin && !loading),
  });
  const template = queryData(query);
  if (!user?.isAdmin || loading) return <p>Admin access required.</p>;
  if (props.templateId && !template)
    return (
      <div className="modal show">
        <div className="modal-content">
          <QueryFeedback query={query} />
          <button className="btn btn-secondary" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>
    );
  return (
    <TemplateEditorForm
      {...props}
      key={`${user.id}-${props.eventId}-${props.templateId ?? 'new'}`}
      initialData={
        template
          ? {
              name: template.name,
              description: template.description ?? '',
              accessCode: template.access_code ?? '',
              schema: template.schema,
            }
          : props.initialData
      }
      brackets={queryData(bracketsQuery) ?? []}
      feedback={
        <>
          <QueryFeedback query={query} />
          <QueryFeedback query={bracketsQuery} />
        </>
      }
    />
  );
}

function TemplateEditorForm({
  templateId,
  eventId,
  onClose,
  onSave,
  initialData,
  feedback,
  brackets,
}: TemplateEditorModalProps & {
  feedback: React.ReactNode;
  brackets: Bracket[];
}) {
  const { user } = useAuth();
  const { save } = useTemplateMutations();
  const [draft] = useState(
    () =>
      initialData ?? {
        name: '',
        description: '',
        accessCode: '',
        schema: {
          fields: [
            {
              id: 'example_field',
              label: 'Example Field',
              type: 'text',
              required: true,
              placeholder: 'Enter value',
            },
          ],
        },
      },
  );
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description);
  const [accessCode, setAccessCode] = useState(draft.accessCode);
  const [schema, setSchema] = useState(() =>
    JSON.stringify(draft.schema, null, 2),
  );
  const [gameAreasImage, setGameAreasImage] = useState<string | null>(
    draft.schema.gameAreasImage ?? null,
  );
  const [uploadingImage, setUploadingImage] = useState(false);
  const parsedSchema = (() => {
    try {
      return JSON.parse(schema);
    } catch {
      return null;
    }
  })();
  const isBracketScoreSheet =
    parsedSchema?.bracketSource?.type === 'db' ||
    parsedSchema?.mode === 'head-to-head';
  const legacyBracketId = parsedSchema?.bracketSource?.bracketId;
  const eventScopedBracketSource = isEventScopedBracketSource(
    parsedSchema?.bracketSource,
    parsedSchema?.eventId,
  );

  // Handle image upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (limit to 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be less than 2MB');
      return;
    }

    // Check file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file');
      return;
    }

    setUploadingImage(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      setGameAreasImage(event.target?.result as string);
      setUploadingImage(false);
    };
    reader.onerror = () => {
      alert('Failed to read image file');
      setUploadingImage(false);
    };
    reader.readAsDataURL(file);
  };

  const handleRemoveImage = () => {
    if (
      window.confirm('Are you sure you want to remove the game areas image?')
    ) {
      setGameAreasImage(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.isAdmin || save.isPending) return;

    if (!templateId && !accessCode.trim()) {
      alert('Access code is required');
      return;
    }

    try {
      const parsedSchema = JSON.parse(schema);

      // Add game areas image to schema if present
      if (gameAreasImage) {
        parsedSchema.gameAreasImage = gameAreasImage;
      } else {
        delete parsedSchema.gameAreasImage;
      }

      save.mutate(
        {
          userId: user.id,
          templateId: templateId ?? undefined,
          eventId,
          data: { name, description, accessCode, schema: parsedSchema },
        },
        {
          onSuccess: () =>
            onSave(
              templateId
                ? 'Score sheet updated successfully!'
                : 'Score sheet created successfully!',
            ),
        },
      );
    } catch (error) {
      console.error('Error saving template:', error);
      if (error instanceof SyntaxError) {
        alert('Invalid JSON schema. Please check your syntax.');
      } else {
        alert('Failed to save template. Please try again.');
      }
    }
  };

  const legacyBracket = legacyBracketId
    ? (brackets.find((bracket) => bracket.id === legacyBracketId) ?? null)
    : null;
  const bracketSourceEventId = getBracketSourceEventId(
    parsedSchema?.bracketSource,
    eventId,
  );

  return (
    <div className="modal show" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <span className="close" onClick={onClose}>
          &times;
        </span>
        <h3>
          {templateId
            ? 'Edit Score Sheet'
            : initialData
              ? 'Review Generated Score Sheet'
              : 'Create New Score Sheet'}
        </h3>
        {initialData && !templateId && (
          <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
            Review and customize the generated score sheet below. You can edit
            any field or add more scoring sections.
          </p>
        )}
        {feedback}
        {save.error && <p role="alert">{save.error.message}</p>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Score Sheet Name</label>
            <input
              type="text"
              className="field-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label>Description</label>
            <textarea
              className="field-input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label>
              Access Code{' '}
              {!templateId && (
                <span style={{ color: 'var(--danger-color)' }}>*</span>
              )}
            </label>
            <input
              type="text"
              className="field-input"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              placeholder={
                templateId
                  ? 'Leave blank to keep the current code'
                  : 'Enter code for judges to use'
              }
              required={!templateId}
            />
            <small>
              {templateId
                ? 'Leave blank to keep the current access code.'
                : 'Judges will need this code to access the score sheet'}
            </small>
          </div>
          <div className="form-group">
            <label>Game Areas Image (Optional)</label>
            <div
              style={{
                border: '2px dashed var(--border-color)',
                borderRadius: '0.5rem',
                padding: '1rem',
                textAlign: 'center',
                background: 'var(--bg-color)',
              }}
            >
              {gameAreasImage ? (
                <div>
                  <img
                    src={gameAreasImage}
                    alt="Game Areas"
                    style={{
                      maxWidth: '100%',
                      maxHeight: '200px',
                      borderRadius: '0.25rem',
                      marginBottom: '0.5rem',
                    }}
                  />
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'center',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={handleRemoveImage}
                    >
                      Remove Image
                    </button>
                    <label
                      className="btn btn-secondary"
                      style={{
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                      }}
                    >
                      Replace Image
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleImageUpload}
                        style={{ display: 'none' }}
                      />
                    </label>
                  </div>
                </div>
              ) : (
                <div>
                  <label
                    className="btn btn-primary"
                    style={{ cursor: 'pointer', display: 'inline-block' }}
                  >
                    {uploadingImage
                      ? 'Uploading...'
                      : 'Upload Game Areas Image'}
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageUpload}
                      disabled={uploadingImage}
                      style={{ display: 'none' }}
                    />
                  </label>
                  <p
                    style={{
                      marginTop: '0.5rem',
                      color: 'var(--secondary-color)',
                      fontSize: '0.875rem',
                    }}
                  >
                    Upload an image of the game field layout. This will be shown
                    as a "Game Areas" button on the scoresheet.
                  </p>
                </div>
              )}
            </div>
          </div>
          <div className="form-group">
            <label>Score Sheet Schema (JSON)</label>
            <textarea
              className="field-input"
              rows={12}
              value={schema}
              onChange={(e) => setSchema(e.target.value)}
              required
              style={{ fontFamily: 'monospace', fontSize: '0.9rem' }}
            />
            <small>Define fields, types, and options in JSON format</small>
          </div>
          {isBracketScoreSheet && (
            <div className="form-group">
              <label>Bracket Source</label>
              <div
                style={{
                  background: 'var(--bg-color)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '0.5rem',
                  padding: '0.9rem 1rem',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>
                  {eventScopedBracketSource
                    ? 'Event-wide bracket games'
                    : 'Legacy bracket-scoped template'}
                </div>
                <div
                  style={{
                    color: 'var(--secondary-color)',
                    fontSize: '0.9rem',
                  }}
                >
                  {eventScopedBracketSource
                    ? `Reads bracket games across event ${bracketSourceEventId ?? eventId}.`
                    : 'Older templates can still keep a legacy bracketId in JSON.'}
                </div>
                {legacyBracketId != null && (
                  <div
                    style={{
                      marginTop: '0.75rem',
                      fontSize: '0.9rem',
                      color: 'var(--secondary-color)',
                    }}
                  >
                    Legacy bracket metadata:{' '}
                    <strong>
                      {legacyBracket
                        ? `${legacyBracket.name} (${legacyBracket.bracket_size}-team)`
                        : `Bracket #${legacyBracketId}`}
                    </strong>
                  </div>
                )}
              </div>
              <small>
                Saving will preserve any legacy `bracketId` still present in the
                JSON, but new templates no longer require one.
              </small>
            </div>
          )}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={save.isPending}
          >
            {templateId ? 'Update Score Sheet' : 'Create Score Sheet'}
          </button>
        </form>
      </div>
    </div>
  );
}
