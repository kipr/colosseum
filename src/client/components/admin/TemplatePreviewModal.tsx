import React, { useEffect, useState } from 'react';
import '../Modal.css';
import '../../pages/Scoresheet.css';

interface TemplatePreviewModalProps {
  templateId: number;
  onClose: () => void;
}

export default function TemplatePreviewModal({ templateId, onClose }: TemplatePreviewModalProps) {
  const [template, setTemplate] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTemplate();
  }, [templateId]);

  const loadTemplate = async () => {
    try {
      const response = await fetch(`/scoresheet/templates/${templateId}`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to load template');
      const data = await response.json();
      setTemplate(data);
    } catch (error) {
      console.error('Error loading template:', error);
      alert('Failed to load template preview');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const renderField = (field: any) => {
    if (field.type === 'section_header') {
      return <div key={field.id} className="section-header">{field.label}</div>;
    }

    if (field.type === 'group_header') {
      return <div key={field.id} className="group-header">{field.label}</div>;
    }

    if (field.type === 'calculated') {
      const className = field.isGrandTotal ? 'grand-total-field' : field.isTotal ? 'total-field' : 'subtotal-field';
      return (
        <div key={field.id} className={`score-field ${className}`}>
          <label className="score-label" style={{ fontWeight: field.isTotal || field.isGrandTotal ? 700 : 600 }}>
            {field.label}
          </label>
          <div className="calculated-value">0</div>
        </div>
      );
    }

    return (
      <div key={field.id} className="score-field">
        <label className="score-label">
          {field.label}
          {field.suffix && <span className="multiplier">{field.suffix}</span>}
        </label>
        {field.type === 'text' && <input type="text" className="score-input" placeholder={field.placeholder || ''} disabled />}
        {field.type === 'number' && <input type="number" className="score-input" value="0" disabled />}
        {field.type === 'dropdown' && (
          <select className="score-input" disabled>
            <option>Select...</option>
          </select>
        )}
        {field.type === 'buttons' && (
          <div className="score-button-group">
            {field.options?.map((opt: any) => (
              <button key={opt.value} type="button" className="score-option-button" disabled>
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {field.type === 'checkbox' && <input type="checkbox" disabled />}
      </div>
    );
  };

  return (
    <div className="modal show" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: '95%', maxHeight: '95vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <span className="close" onClick={onClose}>&times;</span>
        <h3 style={{ marginBottom: '1rem' }}>Template Preview</h3>
        {loading ? (
          <p>Loading preview...</p>
        ) : template ? (
          <div style={{ background: 'var(--bg-color)', padding: '1rem', borderRadius: '0.5rem' }}>
            <div className="scoresheet-form" style={{ background: 'var(--card-bg)' }}>
              {template.schema.title && <div className="scoresheet-title">{template.schema.title}</div>}

              <div className="scoresheet-header-fields">
                {template.schema.fields.filter((f: any) => !f.column && f.type !== 'section_header' && f.type !== 'group_header' && f.type !== 'calculated').map(renderField)}
              </div>

              {template.schema.layout === 'two-column' ? (
                <div className="scoresheet-columns">
                  <div className="scoresheet-column">
                    {template.schema.fields.filter((f: any) => f.column === 'left').map(renderField)}
                  </div>
                  <div className="scoresheet-column">
                    {template.schema.fields.filter((f: any) => f.column === 'right').map(renderField)}
                  </div>
                </div>
              ) : (
                <div>
                  {template.schema.fields.filter((f: any) => !f.column && f.type !== 'section_header' && f.type !== 'group_header').map(renderField)}
                </div>
              )}

              {/* Render grand total if it exists */}
              {template.schema.fields.filter((f: any) => f.isGrandTotal).map(renderField)}
            </div>
          </div>
        ) : (
          <p>Failed to load template</p>
        )}
        <div style={{ textAlign: 'center', marginTop: '1rem' }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

