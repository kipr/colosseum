import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import {
  fieldTemplatesQueryOptions,
  useTemplateMutations,
} from '../../queries/templates';
import type { FieldTemplate } from '../../api/templates';
import QueryFeedback, { queryData } from '../QueryFeedback';
import React, { useState } from 'react';
import '../Modal.css';

interface FieldTemplateModalProps {
  templateId: number | null;
  onClose: () => void;
  onSave: (message: string) => void;
}

export default function FieldTemplateModal(props: FieldTemplateModalProps) {
  const { user, loading } = useAuth();
  const query = useQuery({
    ...fieldTemplatesQueryOptions(user?.id ?? 0),
    enabled: Boolean(user && !loading),
  });
  const template = queryData(query)?.find(({ id }) => id === props.templateId);
  if (!user || loading) return null;
  if (props.templateId && !template)
    return (
      <div className="modal show">
        <div className="modal-content">
          <QueryFeedback query={query} />
          {query.isSuccess && <p>Field template not found.</p>}
          <button className="btn btn-secondary" onClick={props.onClose}>
            Close
          </button>
        </div>
      </div>
    );
  return (
    <FieldTemplateForm
      {...props}
      key={`${user.id}-${props.templateId ?? 'new'}`}
      template={template}
      feedback={<QueryFeedback query={query} />}
    />
  );
}

function FieldTemplateForm({
  templateId,
  onClose,
  onSave,
  template,
  feedback,
}: FieldTemplateModalProps & {
  template?: FieldTemplate;
  feedback: React.ReactNode;
}) {
  const { user } = useAuth();
  const { saveField } = useTemplateMutations();
  const [name, setName] = useState(template?.name ?? '');
  const [description, setDescription] = useState(template?.description ?? '');
  const [fieldsJson, setFieldsJson] = useState(() =>
    JSON.stringify(
      template?.fields ?? [
        {
          id: 'example_field',
          label: 'Example Field',
          type: 'number',
          required: false,
          min: 0,
          step: 1,
        },
      ],
      null,
      2,
    ),
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || saveField.isPending) return;

    try {
      const parsedFields = JSON.parse(fieldsJson);

      if (!Array.isArray(parsedFields)) {
        alert('Fields must be a JSON array');
        return;
      }

      saveField.mutate(
        {
          userId: user.id,
          templateId: templateId ?? undefined,
          data: { name, description, fields: parsedFields },
        },
        {
          onSuccess: () =>
            onSave(
              templateId
                ? 'Field template updated!'
                : 'Field template created!',
            ),
        },
      );
    } catch (error) {
      console.error('Error saving template:', error);
      if (error instanceof SyntaxError) {
        alert('Invalid JSON. Please check your syntax.');
      } else {
        alert(
          `Failed to save template: ${error instanceof Error ? error.message : 'Please try again.'}`,
        );
      }
    }
  };

  return (
    <div className="modal show" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <span className="close" onClick={onClose}>
          &times;
        </span>
        <h3>{templateId ? 'Edit Field Template' : 'Create Field Template'}</h3>
        <p style={{ color: 'var(--secondary-color)', marginBottom: '1.5rem' }}>
          Field templates are reusable scoring field patterns that work for both
          seeding and DE score sheets.
        </p>
        {feedback}
        {saveField.error && <p role="alert">{saveField.error.message}</p>}
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
            <small>
              This template can be used for both seeding and DE score sheets
            </small>
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
              Define your scoring fields as a JSON array. These will be inserted
              into score sheets created with this template.
            </small>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            disabled={saveField.isPending}
          >
            {templateId ? 'Update Template' : 'Create Template'}
          </button>
        </form>
      </div>
    </div>
  );
}
