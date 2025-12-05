import React, { useEffect, useState } from 'react';
import '../Modal.css';

interface FieldTemplateModalProps {
  templateId: number | null;
  onClose: () => void;
  onSave: () => void;
}

export default function FieldTemplateModal({ templateId, onClose, onSave }: FieldTemplateModalProps) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [fieldsJson, setFieldsJson] = useState('');
  const [loading, setLoading] = useState(!!templateId);

  useEffect(() => {
    if (templateId) {
      loadTemplate();
    } else {
      // Default empty fields array
      setFieldsJson(JSON.stringify([
        {
          id: "example_field",
          label: "Example Field",
          type: "number",
          required: false,
          min: 0,
          step: 1
        }
      ], null, 2));
    }
  }, [templateId]);

  const loadTemplate = async () => {
    try {
      const response = await fetch(`/field-templates/${templateId}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to load template');
      const template = await response.json();
      
      setName(template.name);
      setDescription(template.description || '');
      setFieldsJson(JSON.stringify(template.fields, null, 2));
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

    try {
      const parsedFields = JSON.parse(fieldsJson);
      
      if (!Array.isArray(parsedFields)) {
        alert('Fields must be a JSON array');
        return;
      }
      
      const method = templateId ? 'PUT' : 'POST';
      const url = templateId ? `/field-templates/${templateId}` : '/field-templates';

      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ 
          name, 
          description,
          fields: parsedFields
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to save template');
      }

      showSuccessMessage(templateId ? 'Field template updated!' : 'Field template created!');
      onSave();
    } catch (error: any) {
      console.error('Error saving template:', error);
      if (error instanceof SyntaxError) {
        alert('Invalid JSON. Please check your syntax.');
      } else {
        alert(`Failed to save template: ${error.message || 'Please try again.'}`);
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
        <h3>{templateId ? 'Edit Field Template' : 'Create Field Template'}</h3>
        <p style={{ color: 'var(--secondary-color)', marginBottom: '1.5rem' }}>
          Field templates are reusable scoring field patterns that work for both seeding and DE score sheets.
        </p>
        {loading ? (
          <p>Loading...</p>
        ) : (
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label>Template Name *</label>
              <input
                type="text"
                className="field-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Botball 2024 Scoring Fields"
                required
              />
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <textarea
                className="field-input"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description of what this template is for"
              />
              <small>This template can be used for both seeding and DE score sheets</small>
            </div>
            
            <div className="form-group">
              <label>Scoring Fields (JSON Array) *</label>
              <textarea
                className="field-input"
                rows={15}
                value={fieldsJson}
                onChange={(e) => setFieldsJson(e.target.value)}
                style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}
                required
              />
              <small>
                Define your scoring fields as a JSON array. These will be inserted into score sheets created with this template.
              </small>
            </div>
            
            <button type="submit" className="btn btn-primary">
              {templateId ? 'Update Template' : 'Create Template'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

