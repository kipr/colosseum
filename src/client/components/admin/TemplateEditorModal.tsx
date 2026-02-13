/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useEffect, useState } from 'react';
import '../Modal.css';

interface SpreadsheetConfig {
  id: number;
  spreadsheet_name: string;
  sheet_name: string;
}

interface TemplateEditorModalProps {
  templateId: number | null;
  onClose: () => void;
  onSave: () => void;
  initialData?: {
    name: string;
    description: string;
    accessCode: string;
    schema: any;
    spreadsheetConfigId: number | '' | null;
  };
}

export default function TemplateEditorModal({
  templateId,
  onClose,
  onSave,
  initialData,
}: TemplateEditorModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [schema, setSchema] = useState('');
  const [spreadsheetConfigId, setSpreadsheetConfigId] = useState<
    number | '' | null
  >('');
  const [spreadsheets, setSpreadsheets] = useState<SpreadsheetConfig[]>([]);
  const [loading, setLoading] = useState(!!templateId);
  const [gameAreasImage, setGameAreasImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  useEffect(() => {
    loadSpreadsheets();
    if (templateId) {
      loadTemplate();
    } else if (initialData) {
      // Pre-fill from wizard data
      setName(initialData.name);
      setDescription(initialData.description);
      setAccessCode(initialData.accessCode);
      setSchema(JSON.stringify(initialData.schema, null, 2));
      setSpreadsheetConfigId(initialData.spreadsheetConfigId ?? '');
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
    }
  }, [templateId, initialData]);

  const loadSpreadsheets = async () => {
    try {
      // Load all spreadsheet configs (no deduplication - we want individual sheets)
      const response = await fetch('/admin/spreadsheets', {
        credentials: 'include',
      });
      if (!response.ok) {
        console.error('Failed to load spreadsheets, status:', response.status);
        throw new Error('Failed to load spreadsheets');
      }
      const data = await response.json();
      setSpreadsheets(data);
    } catch (error) {
      console.error('Error loading spreadsheets:', error);
    }
  };

  const loadTemplate = async () => {
    try {
      const response = await fetch(`/scoresheet/templates/${templateId}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to load template');
      const template = await response.json();

      setName(template.name);
      setDescription(template.description || '');
      setAccessCode(template.access_code || '');
      // Extract gameAreasImage from schema before stringifying
      if (template.schema?.gameAreasImage) {
        setGameAreasImage(template.schema.gameAreasImage);
      }
      setSchema(JSON.stringify(template.schema, null, 2));
      setSpreadsheetConfigId(template.spreadsheet_config_id || '');
    } catch (error) {
      console.error('Error loading template:', error);
      alert('Failed to load template');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!accessCode.trim()) {
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

      const method = templateId ? 'PUT' : 'POST';
      const url = templateId
        ? `/scoresheet/templates/${templateId}`
        : '/scoresheet/templates';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name,
          description,
          accessCode,
          schema: parsedSchema,
          spreadsheetConfigId: spreadsheetConfigId || null,
        }),
      });

      if (!response.ok) throw new Error('Failed to save template');

      showSuccessMessage(
        templateId
          ? 'Score sheet updated successfully!'
          : 'Score sheet created successfully!',
      );
      onSave();
    } catch (error) {
      console.error('Error saving template:', error);
      if (error instanceof SyntaxError) {
        alert('Invalid JSON schema. Please check your syntax.');
      } else {
        alert('Failed to save template. Please try again.');
      }
    }
  };

  const showSuccessMessage = (message: string) => {
    const messageDiv = document.createElement('div');
    messageDiv.textContent = message;
    messageDiv.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background-color: var(--success-color);
      color: white;
      padding: 1rem 1.5rem;
      border-radius: 0.5rem;
      box-shadow: var(--shadow-lg);
      z-index: 2000;
    `;
    document.body.appendChild(messageDiv);
    setTimeout(() => messageDiv.remove(), 3000);
  };

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
        {initialData && (
          <p style={{ color: 'var(--secondary-color)', marginBottom: '1rem' }}>
            Review and customize the generated score sheet below. You can edit
            any field or add more scoring sections.
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
              <label>Destination Sheet</label>
              <select
                className="field-input"
                value={spreadsheetConfigId}
                onChange={(e) =>
                  setSpreadsheetConfigId(
                    e.target.value ? parseInt(e.target.value) : '',
                  )
                }
              >
                <option value="">-- Select Sheet --</option>
                {spreadsheets.map((config) => (
                  <option key={config.id} value={config.id}>
                    {config.spreadsheet_name} → {config.sheet_name} (
                    {config.sheet_purpose})
                  </option>
                ))}
              </select>
              <small>
                The sheet where scores will be written (or bracket sheet for DE)
              </small>
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
              <small>
                Judges will need this code to access the score sheet
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
                      Upload an image of the game field layout. This will be
                      shown as a "Game Areas" button on the scoresheet.
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
            <button type="submit" className="btn btn-primary">
              {templateId ? 'Update Score Sheet' : 'Create Score Sheet'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
