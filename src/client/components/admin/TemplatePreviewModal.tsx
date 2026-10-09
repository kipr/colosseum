/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useState } from 'react';
import {
  calculateFormulaValues,
  calculateRepeatableGroupDerivedRows,
  getDisplayedNumberValue,
  getNumberPlaceholder,
  normalizeRepeatableGroupRows,
} from '../scoresheetUtils';
import {
  getBlankFieldValue,
  getFieldDefaultValue,
} from '../../../shared/scoresheetSchema';
import { apiFetch } from '../../utils/api';
import Modal from '../Modal';
import type { ToastNotifier } from '../Toast';
import {
  CalculatedField,
  OptionButtonGroup,
  OptionSelect,
  RepeatableGroupChildInput,
  RepeatableGroupTable,
  ScoreFieldWrapper,
  ScoresheetHeading,
  getDerivedColumns,
  getRepeatableChildColumns,
  getRepeatableGroupLiveDerivedColumns,
} from '../scoresheet/ScoresheetFieldParts';
import '../../pages/Scoresheet.css';

interface TemplatePreviewModalProps {
  templateId: number;
  onClose: () => void;
  toast: ToastNotifier;
}

const NON_INPUT_FIELD_TYPES = ['section_header', 'group_header', 'calculated'];

// The values a judge's sheet starts with: schema defaults, or blanks. Event
// data (dataSource and bracket dropdowns) is not loaded for a preview.
function getPreviewValues(fields: any[]): Record<string, any> {
  const values: Record<string, any> = {};

  fields.forEach((field: any) => {
    if (field.type === 'repeatableGroup') {
      values[field.id] = normalizeRepeatableGroupRows(
        getFieldDefaultValue(field),
        field,
      );
    } else if (!NON_INPUT_FIELD_TYPES.includes(field.type)) {
      values[field.id] = getBlankFieldValue(field);
    }
  });

  return values;
}

export default function TemplatePreviewModal({
  templateId,
  onClose,
  toast,
}: TemplatePreviewModalProps) {
  const [template, setTemplate] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Ignore a load that finishes after this modal closed or switched.
    let active = true;
    loadTemplate(() => active);
    return () => {
      active = false;
    };
  }, [templateId]);

  const loadTemplate = async (isActive: () => boolean) => {
    try {
      const data = await apiFetch(`/scoresheet/templates/${templateId}`, {
        fallbackError: 'Failed to load template',
      });
      if (!isActive()) return;
      setTemplate(data);
    } catch (error) {
      if (!isActive()) return;
      console.error('Error loading template:', error);
      toast.error('Failed to load template preview');
      onClose();
    } finally {
      if (isActive()) setLoading(false);
    }
  };

  const fields: any[] = template?.schema?.fields ?? [];
  const previewValues = getPreviewValues(fields);
  const calculatedValues = calculateFormulaValues(
    fields,
    previewValues,
  ).calculated;

  const renderRepeatableGroup = (field: any) => {
    const rows = previewValues[field.id];
    const columns = [
      ...getRepeatableChildColumns(field, rows, (childField, value) => (
        <RepeatableGroupChildInput childField={childField} value={value} />
      )),
      ...getDerivedColumns(
        getRepeatableGroupLiveDerivedColumns(field),
        calculateRepeatableGroupDerivedRows(field, rows),
      ),
    ];

    return (
      <RepeatableGroupTable
        key={field.id}
        title={field.label}
        suffix={field.suffix}
        rowLabel={field.rowLabel || 'Row'}
        rowCount={rows.length}
        columns={columns}
      />
    );
  };

  const renderFieldInput = (field: any, value: any) => {
    if (field.type === 'text') {
      return (
        <input
          type="text"
          className="score-input"
          placeholder={field.placeholder || ''}
          value={value ?? ''}
          disabled
        />
      );
    }

    if (field.type === 'number') {
      return (
        <input
          type="number"
          className="score-input"
          min={field.min ?? 0}
          max={field.max}
          step={field.step || 1}
          value={getDisplayedNumberValue(field, value, false)}
          placeholder={getNumberPlaceholder(field, value, false)}
          disabled
        />
      );
    }

    if (field.type === 'dropdown') {
      return (
        <OptionSelect
          options={field.options}
          value={value}
          style={{ width: '100%' }}
        />
      );
    }

    if (field.type === 'buttons') {
      return <OptionButtonGroup options={field.options} value={value} />;
    }

    if (field.type === 'checkbox') {
      return <input type="checkbox" checked={!!value} disabled />;
    }

    return null;
  };

  const renderField = (field: any) => {
    if (field.type === 'section_header' || field.type === 'group_header') {
      return <ScoresheetHeading key={field.id} field={field} />;
    }

    if (field.type === 'calculated') {
      return (
        <CalculatedField
          key={field.id}
          field={field}
          value={calculatedValues[field.id] || 0}
        />
      );
    }

    if (field.type === 'repeatableGroup') {
      return renderRepeatableGroup(field);
    }

    return (
      <ScoreFieldWrapper key={field.id} field={field}>
        {renderFieldInput(field, previewValues[field.id])}
      </ScoreFieldWrapper>
    );
  };

  return (
    <Modal
      onClose={onClose}
      className="template-preview-modal"
      style={{ maxWidth: '95%' }}
    >
      <h3 style={{ marginBottom: '1rem' }}>Template Preview</h3>
      {loading ? (
        <p>Loading preview...</p>
      ) : template ? (
        <div
          style={{
            background: 'var(--bg-color)',
            padding: '1rem',
            borderRadius: '0.5rem',
          }}
        >
          <div
            className="scoresheet-form"
            style={{ background: 'var(--card-bg)' }}
          >
            {template.schema.title && (
              <div className="scoresheet-title">{template.schema.title}</div>
            )}

            <div className="scoresheet-header-fields">
              {template.schema.fields
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
                  {template.schema.fields
                    .filter((f: any) => f.column === 'left')
                    .map(renderField)}
                </div>
                <div className="scoresheet-column">
                  {template.schema.fields
                    .filter((f: any) => f.column === 'right')
                    .map(renderField)}
                </div>
              </div>
            ) : (
              <div>
                {template.schema.fields
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
            {template.schema.fields
              .filter((f: any) => f.isGrandTotal)
              .map(renderField)}
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
    </Modal>
  );
}
