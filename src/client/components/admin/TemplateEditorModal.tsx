import React, { useEffect, useState } from 'react';
import '../Modal.css';

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
  const [loading, setLoading] = useState(!!templateId);

  useEffect(() => {
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
        body: JSON.stringify({ name, description, accessCode, schema: parsedSchema })
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

