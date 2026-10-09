/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from 'react';
import {
  getBracketSourceEventId,
  isEventScopedBracketSource,
} from '../scoresheetUtils';
import { apiFetch } from '../../utils/api';
import type { Bracket } from '../../types/brackets';
import Modal from '../Modal';
import type { ToastNotifier } from '../Toast';

interface TemplateEditorModalProps {
  templateId: number | null;
  eventId: number;
  onClose: () => void;
  onSave: () => void;
  toast: ToastNotifier;
  initialData?: {
    name: string;
    description: string;
    accessCode: string;
    schema: any;
  };
}

export default function TemplateEditorModal({
  templateId,
  eventId,
  onClose,
  onSave,
  toast,
  initialData,
}: TemplateEditorModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [schema, setSchema] = useState('');
  const [loading, setLoading] = useState(!!templateId);
  const [gameAreasImage, setGameAreasImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [brackets, setBrackets] = useState<Bracket[]>([]);
  const [isBracketScoreSheet, setIsBracketScoreSheet] = useState(false);
  const [legacyBracketId, setLegacyBracketId] = useState<number | null>(null);
  const [eventScopedBracketSource, setEventScopedBracketSource] =
    useState(false);

  const updateBracketStateFromSchema = (schemaData: any) => {
    const isBracket =
      schemaData?.bracketSource?.type === 'db' ||
      schemaData?.mode === 'head-to-head';
    setIsBracketScoreSheet(isBracket);
    setLegacyBracketId(
      typeof schemaData?.bracketSource?.bracketId === 'number'
        ? schemaData.bracketSource.bracketId
        : null,
    );
    setEventScopedBracketSource(
      isEventScopedBracketSource(
        schemaData?.bracketSource,
        schemaData?.eventId,
      ),
    );
  };

  const loadBrackets = async () => {
    try {
      const data = await apiFetch<Bracket[]>(`/brackets/event/${eventId}`, {
        fallbackError: 'Failed to load brackets',
      });
      setBrackets(data);
    } catch (error) {
      console.error('Error loading brackets:', error);
      setBrackets([]);
    }
  };

  useEffect(() => {
    loadBrackets();
  }, [eventId]);

  useEffect(() => {
    if (templateId) {
      loadTemplate();
    } else if (initialData) {
      // Pre-fill from wizard data
      setName(initialData.name);
      setDescription(initialData.description);
      setAccessCode(initialData.accessCode);
      setSchema(JSON.stringify(initialData.schema, null, 2));
      updateBracketStateFromSchema(initialData.schema);
      // Load game areas image from schema if present
      if (initialData.schema?.gameAreasImage) {
        setGameAreasImage(initialData.schema.gameAreasImage);
      }
    } else {
      // New template with example schema
      setSchema(
        JSON.stringify(
          {
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
          null,
          2,
        ),
      );
      setIsBracketScoreSheet(false);
      setLegacyBracketId(null);
      setEventScopedBracketSource(false);
    }
  }, [templateId, initialData]);

  const loadTemplate = async () => {
    try {
      const template = await apiFetch<any>(
        `/scoresheet/templates/${templateId}`,
        {
          fallbackError: 'Failed to load template',
        },
      );

      setName(template.name);
      setDescription(template.description || '');
      setAccessCode(template.access_code || '');
      // Extract gameAreasImage from schema before stringifying
      if (template.schema?.gameAreasImage) {
        setGameAreasImage(template.schema.gameAreasImage);
      }
      setSchema(JSON.stringify(template.schema, null, 2));
      updateBracketStateFromSchema(template.schema);
    } catch (error) {
      console.error('Error loading template:', error);
      toast.error('Failed to load template');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  // Handle image upload
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file size (limit to 2MB)
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Image must be less than 2MB');
      return;
    }

    // Check file type
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file');
      return;
    }

    setUploadingImage(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      setGameAreasImage(event.target?.result as string);
      setUploadingImage(false);
    };
    reader.onerror = () => {
      toast.error('Failed to read image file');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!accessCode.trim()) {
      toast.error('Access code is required');
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

      const method = templateId ? 'PUT' : 'POST';
      const url = templateId
        ? `/scoresheet/templates/${templateId}`
        : '/scoresheet/templates';

      await apiFetch(url, {
        method,
        body: {
          name,
          description,
          accessCode,
          schema: parsedSchema,
          eventId,
        },
        fallbackError: 'Failed to save template',
      });

      toast.success(
        templateId
          ? 'Score sheet updated successfully!'
          : 'Score sheet created successfully!',
      );
      onSave();
    } catch (error) {
      console.error('Error saving template:', error);
      if (error instanceof SyntaxError) {
        toast.error('Invalid JSON schema. Please check your syntax.');
      } else {
        toast.error('Failed to save template. Please try again.');
      }
    }
  };

  const legacyBracket = legacyBracketId
    ? (brackets.find((bracket) => bracket.id === legacyBracketId) ?? null)
    : null;
  const bracketSourceEventId = getBracketSourceEventId(
    (() => {
      try {
        return JSON.parse(schema)?.bracketSource;
      } catch {
        return null;
      }
    })(),
    eventId,
  );

  return (
    <Modal onClose={onClose}>
      <h3>
        {templateId
          ? 'Edit Score Sheet'
          : initialData
            ? 'Review Generated Score Sheet'
            : 'Create New Score Sheet'}
      </h3>
      {initialData && (
        <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
          Review and customize the generated score sheet below. You can edit any
          field or add more scoring sections.
        </p>
      )}
      {loading ? (
        <p>Loading...</p>
      ) : (
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
              <span style={{ color: 'var(--danger-color)' }}>*</span>
            </label>
            <input
              type="text"
              className="field-input"
              value={accessCode}
              onChange={(e) => setAccessCode(e.target.value)}
              placeholder="Enter code for judges to use"
              required
            />
            <small>Judges will need this code to access the score sheet</small>
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
              onChange={(e) => {
                const nextSchema = e.target.value;
                setSchema(nextSchema);

                try {
                  const parsedSchema = JSON.parse(nextSchema);
                  updateBracketStateFromSchema(parsedSchema);
                } catch {
                  // Keep current bracket UI state while JSON is temporarily invalid
                }
              }}
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
          <button type="submit" className="btn btn-primary">
            {templateId ? 'Update Score Sheet' : 'Create Score Sheet'}
          </button>
        </form>
      )}
    </Modal>
  );
}
