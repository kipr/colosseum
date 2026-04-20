import React, { useEffect, useState } from 'react';
import '../Modal.css';
import '../../pages/Scoresheet.css';
import {
  type ScoresheetSchema,
  tryParseScoresheetSchema,
} from '../../../shared/domain/scoresheetSchema';
import { ScoresheetFieldList } from '../scoresheet/ScoresheetFieldList';

interface TemplatePreviewModalProps {
  templateId: number;
  onClose: () => void;
}

interface PreviewTemplate {
  id: number;
  name: string;
  schema: ScoresheetSchema | null;
}

export default function TemplatePreviewModal({
  templateId,
  onClose,
}: TemplatePreviewModalProps) {
  const [template, setTemplate] = useState<PreviewTemplate | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadTemplate();
  }, [templateId]);

  const loadTemplate = async () => {
    try {
      const response = await fetch(`/scoresheet/templates/${templateId}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to load template');
      const data = await response.json();
      const parsed = tryParseScoresheetSchema(data.schema);
      if (parsed.ok) {
        setTemplate({ id: data.id, name: data.name, schema: parsed.value });
      } else {
        console.warn(
          'Template schema failed validation; preview omitted for template id',
          data.id,
          parsed.error,
        );
        setTemplate({ id: data.id, name: data.name, schema: null });
      }
    } catch (error) {
      console.error('Error loading template:', error);
      alert('Failed to load template preview');
      onClose();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal show" onClick={onClose}>
      <div
        className="modal-content"
        style={{ maxWidth: '95%', maxHeight: '95vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="close" onClick={onClose}>
          &times;
        </span>
        <h3 style={{ marginBottom: '1rem' }}>Template Preview</h3>
        {loading ? (
          <p>Loading preview...</p>
        ) : template?.schema ? (
          <div
            style={{
              background: 'var(--bg-color)',
              padding: '1rem',
              borderRadius: '0.5rem',
            }}
          >
            <ScoresheetFieldList
              schema={template.schema}
              mode="preview"
              showWinnerSelect={false}
              formClassName="scoresheet-form"
              formStyle={{ background: 'var(--card-bg)' }}
            />
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
