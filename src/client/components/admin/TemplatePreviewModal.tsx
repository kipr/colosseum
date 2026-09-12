/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { templateQueryOptions } from '../../queries/templates';
import QueryFeedback, { queryData } from '../QueryFeedback';
import { normalizeRepeatableGroupRows } from '../scoresheetUtils';
import { getFieldDefaultValue } from '../../../shared/scoresheetSchema';
import ScoresheetFieldControl from '../ScoresheetFieldControl';
import RepeatableGroupTable from '../RepeatableGroupTable';
import '../Modal.css';
import '../../pages/Scoresheet.css';

interface TemplatePreviewModalProps {
  templateId: number;
  onClose: () => void;
}

export default function TemplatePreviewModal({
  templateId,
  onClose,
}: TemplatePreviewModalProps) {
  const { user, loading: authLoading } = useAuth();
  const query = useQuery({
    ...templateQueryOptions(user?.id ?? 0, templateId, Boolean(user?.isAdmin)),
    enabled: Boolean(user && !authLoading),
  });
  const template = user && !authLoading ? queryData(query) : undefined;
  const loading = query.isLoading;

  const getPreviewRepeatableGroupRows = (field: any) => {
    const startingValue = getFieldDefaultValue(field);

    return normalizeRepeatableGroupRows(startingValue, field);
  };

  const renderRepeatableGroupInput = (childField: any, value: any) => (
    <ScoresheetFieldControl
      field={childField}
      value={value}
      disabled
      numberUi="native"
      includeNumberBounds
      includeOrphanDropdownValue
      compareSelectionAsString
      placeholder={
        childField.type === 'number'
          ? childField.placeholder || '0'
          : childField.placeholder || ''
      }
      inputClassName="score-input repeatable-group-input"
      numberClassName="score-input repeatable-group-number"
      buttonGroupClassName="score-button-group repeatable-group-buttons"
    />
  );

  const renderRepeatableGroup = (field: any) => (
    <RepeatableGroupTable
      key={field.id}
      field={field}
      rows={getPreviewRepeatableGroupRows(field)}
      renderControl={(childField, value) =>
        renderRepeatableGroupInput(childField, value)
      }
    />
  );

  const renderField = (field: any) => {
    if (field.type === 'section_header') {
      return (
        <div key={field.id} className="section-header">
          {field.label}
        </div>
      );
    }

    if (field.type === 'group_header') {
      return (
        <div key={field.id} className="group-header">
          {field.label}
        </div>
      );
    }

    if (field.type === 'calculated') {
      const className = field.isGrandTotal
        ? 'grand-total-field'
        : field.isTotal
          ? 'total-field'
          : 'subtotal-field';
      return (
        <div key={field.id} className={`score-field ${className}`}>
          <label
            className="score-label"
            style={{
              fontWeight: field.isTotal || field.isGrandTotal ? 700 : 600,
            }}
          >
            {field.label}
          </label>
          <div className="calculated-value">0</div>
        </div>
      );
    }

    if (field.type === 'repeatableGroup') {
      return renderRepeatableGroup(field);
    }

    return (
      <div key={field.id} className="score-field">
        <label className="score-label">
          {field.label}
          {field.suffix && <span className="multiplier">{field.suffix}</span>}
        </label>
        <ScoresheetFieldControl
          field={field}
          value={field.type === 'number' ? 0 : ''}
          disabled
          numberUi="native"
          placeholder={field.placeholder || ''}
          compareSelectionAsString
        />
      </div>
    );
  };

  return (
    <div className="modal show" onClick={onClose}>
      <div
        className="modal-content score-view-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="close" onClick={onClose}>
          &times;
        </span>
        <div className="score-view-header">
          <h3>Template Preview</h3>
          <QueryFeedback query={query} />
        </div>
        {loading ? (
          <p>Loading preview...</p>
        ) : template ? (
          <div className="score-view-form">
            <div
              className="scoresheet-form"
              style={{ background: 'var(--card-bg)', boxShadow: 'none' }}
            >
              {template.schema.title && (
                <div className="scoresheet-title">{template.schema.title}</div>
              )}

              <div className="scoresheet-header-fields">
                {(template.schema.fields ?? [])
                  .filter(
                    (f: any) =>
                      !f.column &&
                      f.type !== 'section_header' &&
                      f.type !== 'group_header' &&
                      f.type !== 'calculated',
                  )
                  .map(renderField)}
              </div>

              {template.schema.layout === 'two-column' ? (
                <div className="scoresheet-columns">
                  <div className="scoresheet-column">
                    {(template.schema.fields ?? [])
                      .filter((f: any) => f.column === 'left')
                      .map(renderField)}
                  </div>
                  <div className="scoresheet-column">
                    {(template.schema.fields ?? [])
                      .filter((f: any) => f.column === 'right')
                      .map(renderField)}
                  </div>
                </div>
              ) : (
                <div>
                  {(template.schema.fields ?? [])
                    .filter(
                      (f: any) =>
                        !f.column &&
                        f.type !== 'section_header' &&
                        f.type !== 'group_header',
                    )
                    .map(renderField)}
                </div>
              )}

              {/* Render grand total if it exists */}
              {(template.schema.fields ?? [])
                .filter((f: any) => f.isGrandTotal)
                .map(renderField)}
            </div>
          </div>
        ) : (
          <p>Failed to load template</p>
        )}
        <div className="score-view-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
