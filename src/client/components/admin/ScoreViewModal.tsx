/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from 'react';
import '../Modal.css';
import '../../pages/Scoresheet.css';
import { formatDateTime } from '../../utils/dateUtils';

interface ScoreViewModalProps {
  score: any;
  onClose: () => void;
  onSave: () => void;
}

export default function ScoreViewModal({
  score,
  onClose,
  onSave,
}: ScoreViewModalProps) {
  const [template, setTemplate] = useState<any>(null);
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [calculatedValues, setCalculatedValues] = useState<
    Record<string, number>
  >({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const isReadOnly = score.status !== 'pending';

  useEffect(() => {
    loadTemplate();
    initializeFormData();
  }, []);

  useEffect(() => {
    if (template) {
      calculateAllFormulas();
    }
  }, [formData, template]);

  const loadTemplate = async () => {
    try {
      const response = await fetch('/scoresheet/templates');
      if (!response.ok) throw new Error('Failed to load templates');
      const templates = await response.json();

      // Find template by ID first (more reliable), then fall back to name
      let foundTemplate = templates.find(
        (t: any) => t.id === score.template_id,
      );
      if (!foundTemplate) {
        foundTemplate = templates.find(
          (t: any) => t.name === score.template_name,
        );
      }

      if (foundTemplate) {
        setTemplate(foundTemplate);
      } else {
        console.error(
          'Template not found. Score template_id:',
          score.template_id,
          'template_name:',
          score.template_name,
        );
        console.error(
          'Available templates:',
          templates.map((t: any) => ({ id: t.id, name: t.name })),
        );
      }
    } catch (error) {
      console.error('Error loading template:', error);
    } finally {
      setLoading(false);
    }
  };

  const initializeFormData = () => {
    const data: Record<string, any> = {};
    Object.entries(score.score_data).forEach(
      ([fieldId, fieldData]: [string, any]) => {
        data[fieldId] = fieldData.value;
      },
    );
    setFormData(data);
  };

  const calculateAllFormulas = () => {
    if (!template?.schema?.fields) return;

    const calculated: Record<string, number> = {};

    template.schema.fields.forEach((field: any) => {
      if (field.type === 'calculated' && field.formula) {
        try {
          const result = evaluateFormula(field.formula, formData, calculated);
          calculated[field.id] = result;
        } catch {
          calculated[field.id] = 0;
        }
      }
    });

    setCalculatedValues(calculated);
  };

  const evaluateFormula = (
    formula: string,
    data: Record<string, any>,
    calculated: Record<string, number>,
  ): number => {
    let expression = formula;
    const fieldIds = formula.match(/[a-z_][a-z0-9_]*/gi) || [];
    const uniqueFieldIds = Array.from(new Set(fieldIds));

    uniqueFieldIds.forEach((fieldId) => {
      let value: any = 0;

      if (calculated[fieldId] !== undefined) {
        value = calculated[fieldId];
      } else if (data[fieldId] !== undefined && data[fieldId] !== '') {
        value = data[fieldId];
      }

      let replacement: string;
      if (formula.includes(`${fieldId} ===`)) {
        replacement = `'${String(value)}'`;
      } else if (typeof value === 'string') {
        replacement = String(Number(value) || 0);
      } else if (typeof value === 'boolean') {
        replacement = value ? '1' : '0';
      } else {
        replacement = String(Number(value) || 0);
      }

      const regex = new RegExp(`\\b${fieldId}\\b`, 'g');
      expression = expression.replace(regex, replacement);
    });

    try {
      const result = eval(expression);
      return Number(result) || 0;
    } catch {
      return 0;
    }
  };

  const handleInputChange = (fieldId: string, value: any) => {
    if (isReadOnly) return;
    setFormData((prev) => ({ ...prev, [fieldId]: value }));
  };

  const handleSave = async () => {
    if (isReadOnly) {
      onClose();
      return;
    }

    setSaving(true);
    try {
      // Build updated score data with labels and types preserved
      const updatedScoreData: Record<string, any> = {};

      Object.entries(score.score_data).forEach(
        ([fieldId, fieldData]: [string, any]) => {
          updatedScoreData[fieldId] = {
            ...fieldData,
            value:
              formData[fieldId] !== undefined
                ? formData[fieldId]
                : fieldData.value,
          };
        },
      );

      // Update calculated values
      Object.entries(calculatedValues).forEach(([fieldId, value]) => {
        if (updatedScoreData[fieldId]) {
          updatedScoreData[fieldId].value = value;
        }
      });

      const response = await fetch(`/scores/${score.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ scoreData: updatedScoreData }),
      });

      if (!response.ok) throw new Error('Failed to update score');

      alert('Score updated successfully!');
      onSave();
    } catch (error) {
      console.error('Error updating score:', error);
      alert('Failed to update score');
    } finally {
      setSaving(false);
    }
  };

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
      const calcValue =
        calculatedValues[field.id] !== undefined
          ? calculatedValues[field.id]
          : score.score_data[field.id]?.value || 0;
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
          <div className="calculated-value">{calcValue}</div>
        </div>
      );
    }

    const value = formData[field.id] !== undefined ? formData[field.id] : '';
    const isCompact =
      field.type === 'number' ||
      field.type === 'buttons' ||
      field.type === 'checkbox';

    if (field.isMultiplier) {
      return (
        <div key={field.id} className="score-field multiplier-field">
          <label className="score-label">
            <span className="multiplier-label">Multiplier:</span> {field.label}
            {field.suffix && <span className="multiplier">{field.suffix}</span>}
          </label>
          {renderFieldInput(field, value, isCompact)}
        </div>
      );
    }

    return (
      <div
        key={field.id}
        className={`score-field ${isCompact ? 'compact' : ''}`}
      >
        <label className="score-label">
          {field.label}
          {field.suffix && <span className="multiplier">{field.suffix}</span>}
        </label>
        {renderFieldInput(field, value, isCompact)}
      </div>
    );
  };

  const renderFieldInput = (field: any, value: any, isCompact: boolean) => {
    const disabled = isReadOnly || field.autoPopulated;

    return (
      <>
        {field.type === 'text' && (
          <input
            type="text"
            className="score-input"
            value={value}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
            disabled={disabled}
          />
        )}
        {field.type === 'number' && (
          <input
            type="number"
            className="score-input"
            value={value}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
            disabled={disabled}
          />
        )}
        {field.type === 'dropdown' && (
          <select
            className={`score-input ${isCompact ? 'compact' : ''}`}
            value={value}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
            disabled={disabled}
            style={{ width: isCompact ? '70px' : '100%' }}
          >
            <option value="">Select...</option>
            {field.options?.map((opt: any) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
            {/* If the current value isn't in options, show it anyway */}
            {value &&
              !field.options?.some(
                (opt: any) => String(opt.value) === String(value),
              ) && <option value={value}>{value}</option>}
          </select>
        )}
        {field.type === 'buttons' && (
          <div className="score-button-group">
            {field.options?.map((opt: any) => (
              <button
                key={opt.value}
                type="button"
                className={`score-option-button ${String(value) === String(opt.value) ? 'selected' : ''}`}
                onClick={() =>
                  !isReadOnly && handleInputChange(field.id, opt.value)
                }
                disabled={isReadOnly}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {field.type === 'checkbox' && (
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => handleInputChange(field.id, e.target.checked)}
            disabled={disabled}
          />
        )}
      </>
    );
  };

  // Fallback: render raw data in scoresheet-like format
  const renderFallbackScoreData = () => {
    return (
      <div className="scoresheet-form">
        <div className="scoresheet-title">
          Score Details (Template Not Found)
        </div>
        <div className="scoresheet-header-fields">
          {Object.entries(score.score_data)
            .filter(([key]: [string, any]) =>
              ['team_number', 'team_name', 'round'].includes(key),
            )
            .map(([fieldId, data]: [string, any]) => (
              <div key={fieldId} className="score-field">
                <label className="score-label">{data.label}</label>
                <input
                  type="text"
                  className="score-input"
                  value={String(data.value)}
                  disabled
                />
              </div>
            ))}
        </div>

        <div style={{ marginTop: '1rem' }}>
          {Object.entries(score.score_data)
            .filter(
              ([fieldId]: [string, any]) =>
                !['team_number', 'team_name', 'round', 'grand_total'].includes(
                  fieldId,
                ),
            )
            .map(([fieldId, data]: [string, any]) => (
              <div key={fieldId} className="score-field">
                <label className="score-label">{data.label}</label>
                {data.type === 'buttons' ? (
                  <div className="score-button-group">
                    <button className="score-option-button selected" disabled>
                      {String(data.value)}
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    className="score-input"
                    value={String(data.value)}
                    disabled
                    style={{ width: data.type === 'number' ? '70px' : '100%' }}
                  />
                )}
              </div>
            ))}
        </div>

        {score.score_data.grand_total && (
          <div className="score-field grand-total-field">
            <label className="score-label">
              {score.score_data.grand_total.label}
            </label>
            <div className="calculated-value">
              {score.score_data.grand_total.value}
            </div>
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="modal show" onClick={onClose}>
        <div
          className="modal-content score-view-modal"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="close" onClick={onClose}>
            &times;
          </span>
          <p>Loading scoresheet...</p>
        </div>
      </div>
    );
  }

  const schema = template?.schema;

  // Derive winner display for bracket games
  const isBracket = score.score_type === 'bracket';
  const winnerDisplay = isBracket
    ? (() => {
        const data = score.score_data || {};
        const winnerNum = data.winner_team_number?.value;
        const winnerName = data.winner_team_name?.value;
        const winner = data.winner?.value;
        if (winnerNum != null && winnerName != null) {
          return `${winnerNum} - ${winnerName}`;
        }
        if (data.winner_display?.value) return data.winner_display.value;
        if (winner === 'team_a') {
          const n = data.team_a_number?.value ?? '';
          const name = data.team_a_name?.value ?? '';
          return name ? `${n} - ${name}` : n || 'Team A';
        }
        if (winner === 'team_b') {
          const n = data.team_b_number?.value ?? '';
          const name = data.team_b_name?.value ?? '';
          return name ? `${n} - ${name}` : n || 'Team B';
        }
        return null;
      })()
    : null;

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
          <h3>{isReadOnly ? 'View Score' : 'Edit Score'}</h3>
          <div className="score-view-meta">
            <span
              className={`badge badge-${score.status === 'accepted' ? 'success' : score.status === 'rejected' ? 'danger' : 'warning'}`}
            >
              {score.status.charAt(0).toUpperCase() + score.status.slice(1)}
            </span>
            <span>Submitted: {formatDateTime(score.created_at)}</span>
          </div>
        </div>

        {isBracket && winnerDisplay && (
          <div
            className="score-view-winner-banner"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.75rem 1rem',
              marginBottom: '1rem',
              background: 'var(--primary-color)',
              color: 'white',
              borderRadius: '0.5rem',
              fontWeight: 600,
              fontSize: '1.1rem',
            }}
          >
            <span
              style={{
                fontSize: '1.25rem',
                lineHeight: 1,
              }}
              aria-hidden
            >
              ✓
            </span>
            <span>Winner: {winnerDisplay}</span>
          </div>
        )}

        <div className="score-view-form">
          {!template || !schema ? (
            renderFallbackScoreData()
          ) : (
            <div
              className="scoresheet-form"
              style={{ boxShadow: 'none', padding: 0 }}
            >
              {schema.title && (
                <div className="scoresheet-title">{schema.title}</div>
              )}

              <div className="scoresheet-header-fields">
                {schema.fields
                  .filter(
                    (f: any) =>
                      !f.column &&
                      f.type !== 'section_header' &&
                      f.type !== 'group_header' &&
                      f.type !== 'calculated',
                  )
                  .map(renderField)}
              </div>

              {schema.layout === 'two-column' ? (
                <div className="scoresheet-columns">
                  <div className="scoresheet-column">
                    {schema.fields
                      .filter((f: any) => f.column === 'left')
                      .map(renderField)}
                  </div>
                  <div className="scoresheet-column">
                    {schema.fields
                      .filter((f: any) => f.column === 'right')
                      .map(renderField)}
                  </div>
                </div>
              ) : (
                <div>
                  {schema.fields
                    .filter(
                      (f: any) =>
                        !f.column &&
                        f.type !== 'section_header' &&
                        f.type !== 'group_header',
                    )
                    .map(renderField)}
                </div>
              )}

              {/* Render grand total */}
              {schema.fields
                .filter((f: any) => f.isGrandTotal)
                .map(renderField)}
            </div>
          )}
        </div>

        <div className="score-view-actions">
          <button className="btn btn-secondary" onClick={onClose}>
            {isReadOnly ? 'Close' : 'Cancel'}
          </button>
          {!isReadOnly && (
            <button
              className="btn btn-primary"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
