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
}

export default function TemplateEditorModal({ templateId, onClose, onSave }: TemplateEditorModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [schema, setSchema] = useState('');
  const [spreadsheetConfigId, setSpreadsheetConfigId] = useState<number | ''>('');
  const [spreadsheets, setSpreadsheets] = useState<SpreadsheetConfig[]>([]);
  const [loading, setLoading] = useState(!!templateId);

  useEffect(() => {
    loadSpreadsheets();
    if (templateId) {
      loadTemplate();
    } else {
      // New template with example schema
      setSchema(JSON.stringify({
        fields: [
          {
            id: "example_field",
            label: "Example Field",
            type: "text",
            required: true,
            placeholder: "Enter value"
          }
        ]
      }, null, 2));
    }
  }, [templateId]);

  const loadSpreadsheets = async () => {
    try {
      // Use all=true to get all spreadsheets from all admins
      const response = await fetch('/admin/spreadsheets?all=true', { credentials: 'include' });
      if (!response.ok) {
        console.error('Failed to load spreadsheets, status:', response.status);
        throw new Error('Failed to load spreadsheets');
      }
      const data = await response.json();
      // Get unique spreadsheets by spreadsheet_name
      const uniqueSpreadsheets: SpreadsheetConfig[] = [];
      const seen = new Set<string>();
      data.forEach((config: SpreadsheetConfig) => {
        if (config.spreadsheet_name && !seen.has(config.spreadsheet_name)) {
          seen.add(config.spreadsheet_name);
          uniqueSpreadsheets.push(config);
        }
      });
      setSpreadsheets(uniqueSpreadsheets);
    } catch (error) {
      console.error('Error loading spreadsheets:', error);
    }
  };

  const loadTemplate = async () => {
    try {
      const response = await fetch(`/scoresheet/templates/${templateId}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to load template');
      const template = await response.json();
      
      setName(template.name);
      setDescription(template.description || '');
      setAccessCode(template.access_code || '');
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!accessCode.trim()) {
      alert('Access code is required');
      return;
    }

    try {
      const parsedSchema = JSON.parse(schema);
      
      const method = templateId ? 'PUT' : 'POST';
      const url = templateId ? `/scoresheet/templates/${templateId}` : '/scoresheet/templates';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          name, 
          description, 
          accessCode, 
          schema: parsedSchema,
          spreadsheetConfigId: spreadsheetConfigId || null
        })
      });

      if (!response.ok) throw new Error('Failed to save template');

      showSuccessMessage(templateId ? 'Template updated successfully!' : 'Template created successfully!');
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
        <span className="close" onClick={onClose}>&times;</span>
        <h3>{templateId ? 'Edit Template' : 'Create New Template'}</h3>
        {loading ? (
          <p>Loading...</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Template Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label>Description</label>
              <textarea
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Spreadsheet</label>
              <select
                value={spreadsheetConfigId}
                onChange={(e) => setSpreadsheetConfigId(e.target.value ? parseInt(e.target.value) : '')}
              >
                <option value="">-- Select Spreadsheet --</option>
                {spreadsheets.map(config => (
                  <option key={config.id} value={config.id}>
                    {config.spreadsheet_name}
                  </option>
                ))}
              </select>
              <small>Groups this template under the selected spreadsheet for judges</small>
            </div>
            <div className="form-group">
              <label>Access Code <span style={{ color: 'var(--danger-color)' }}>*</span></label>
              <input
                type="text"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="Enter code for judges to use"
                required
              />
              <small>Judges will need this code to access the scoresheet</small>
            </div>
            <div className="form-group">
              <label>Template Schema (JSON)</label>
              <textarea
                rows={12}
                value={schema}
                onChange={(e) => setSchema(e.target.value)}
                required
              />
              <small>Define fields, types, and options in JSON format</small>
            </div>
            <button type="submit" className="btn btn-primary">
              Save Template
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

