/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from 'react';
import '../Modal.css';
import '../../pages/Scoresheet.css';
import { formatDateTime } from '../../utils/dateUtils';
import {
  calculateRepeatableGroupDerivedRows,
  buildRepeatableGroupDerivedScoreEntries,
  buildRepeatableGroupScoreEntry,
  calculateRepeatableGroupDerivedValues,
  getRepeatableGroupRowKeys,
  normalizeRepeatableGroupRows,
  shouldAutoAppendRepeatableGroupRow,
} from '../scoresheetUtils';

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

  const calculateFormulaValues = (data: Record<string, any>) => {
    if (!template?.schema?.fields) return {};

    const calculated: Record<string, number> = {};
    const { outputs } = calculateRepeatableGroupDerivedValues(
      template.schema.fields,
      data,
    );
    const formulaData = { ...data, ...outputs };

    template.schema.fields.forEach((field: any) => {
      if (field.type === 'calculated' && field.formula) {
        try {
          const result = evaluateFormula(
            field.formula,
            formulaData,
            calculated,
          );
          calculated[field.id] = result;
        } catch {
          calculated[field.id] = 0;
        }
      }
    });

    return calculated;
  };

  const calculateAllFormulas = () => {
    setCalculatedValues(calculateFormulaValues(formData));
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

  const handleRepeatableGroupInputChange = (
    field: any,
    rowIndex: number,
    childField: any,
    value: any,
  ) => {
    if (isReadOnly) return;

    setFormData((prev) => {
      const rows = normalizeRepeatableGroupRows(prev[field.id], field).map(
        (row) => ({ ...row }),
      );
      rows[rowIndex] = {
        ...(rows[rowIndex] ??
          normalizeRepeatableGroupRows(undefined, field)[0]),
        [childField.id]: value,
      };

      if (
        field.autoAppendBlankRow &&
        shouldAutoAppendRepeatableGroupRow(rows, field)
      ) {
        rows.push(normalizeRepeatableGroupRows(undefined, field)[0]);
      }

      return {
        ...prev,
        [field.id]: rows,
      };
    });
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

      const fieldsById = new Map(
        (template?.schema?.fields || []).map((field: any) => [field.id, field]),
      );
      const saveCalculatedValues = calculateFormulaValues(formData);
      const { derivedByFieldId } = calculateRepeatableGroupDerivedValues(
        template?.schema?.fields || [],
        formData,
      );

      Object.entries(score.score_data).forEach(
        ([fieldId, fieldData]: [string, any]) => {
          const field = fieldsById.get(fieldId);

          if (field?.type === 'repeatableGroup') {
            updatedScoreData[fieldId] = buildRepeatableGroupScoreEntry(
              field,
              fieldData,
              formData[fieldId] !== undefined
                ? formData[fieldId]
                : fieldData.value,
              derivedByFieldId[fieldId],
            );
          } else {
            updatedScoreData[fieldId] = {
              ...fieldData,
              value:
                formData[fieldId] !== undefined
                  ? formData[fieldId]
                  : fieldData.value,
            };
          }
        },
      );

      // Update calculated values
      Object.entries(saveCalculatedValues).forEach(([fieldId, value]) => {
        if (updatedScoreData[fieldId]) {
          updatedScoreData[fieldId].value = value;
        }
      });

      Object.assign(
        updatedScoreData,
        buildRepeatableGroupDerivedScoreEntries(
          template?.schema?.fields || [],
          derivedByFieldId,
        ),
      );

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

    if (field.type === 'repeatableGroup') {
      return renderRepeatableGroup(field);
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

  const getRepeatableGroupRowsForRender = (field: any) => {
    const submittedRows = Array.isArray(score.score_data?.[field.id]?.value)
      ? score.score_data[field.id].value
      : [];

    if (isReadOnly) {
      return submittedRows;
    }

    const rows = normalizeRepeatableGroupRows(formData[field.id], field);

    if (
      field.autoAppendBlankRow &&
      shouldAutoAppendRepeatableGroupRow(rows, field)
    ) {
      return [...rows, normalizeRepeatableGroupRows(undefined, field)[0]];
    }

    return rows;
  };

  const getRepeatableGroupDerivedRows = (field: any, rows: any[]) => {
    if (!isReadOnly && field.derived) {
      return calculateRepeatableGroupDerivedRows(field, rows);
    }

    const submittedRows = score.score_data?.[field.id]?.derived?.rows;
    return Array.isArray(submittedRows) ? submittedRows : [];
  };

  const getRepeatableGroupDerivedColumns = (field: any, derivedRows: any[]) => {
    const columns =
      field?.derived?.type === 'botballStartBoxCubes'
        ? [{ key: 'subtotal', label: 'Value' }]
        : [
            { key: 'status', label: 'Status' },
            { key: 'sortedColor', label: 'Sorted Color' },
            { key: 'color', label: 'Sorted Color' },
            { key: 'equivalent', label: 'Equivalent' },
            { key: 'subtotal', label: 'Subtotal' },
          ];
    const usedLabels = new Set<string>();

    return columns.filter((column) => {
      if (usedLabels.has(column.label)) {
        return false;
      }

      const hasValue = derivedRows.some(
        (row) =>
          row &&
          typeof row === 'object' &&
          row[column.key] !== undefined &&
          row[column.key] !== null &&
          row[column.key] !== '',
      );

      if (hasValue) {
        usedLabels.add(column.label);
      }

      return hasValue;
    });
  };

  const renderDerivedValue = (value: any, columnKey: string) => {
    if (value === undefined || value === null || value === '') {
      return '';
    }

    if (columnKey === 'sortedColor' || columnKey === 'color') {
      return (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
          }}
        >
          <span
            aria-hidden
            style={{
              width: '0.75rem',
              height: '0.75rem',
              borderRadius: '999px',
              border: '1px solid var(--border-color)',
              backgroundColor: String(value),
              display: 'inline-block',
            }}
          />
          {String(value)}
        </span>
      );
    }

    if (typeof value === 'boolean') {
      return value ? 'Yes' : 'No';
    }

    return String(value);
  };

  const renderRepeatableGroup = (field: any) => {
    const rows = getRepeatableGroupRowsForRender(field);
    const supportedFields = (field.fields || []).filter((childField: any) =>
      ['text', 'number', 'dropdown', 'buttons', 'checkbox'].includes(
        childField.type,
      ),
    );
    const derivedRows = getRepeatableGroupDerivedRows(field, rows);
    const derivedColumns = getRepeatableGroupDerivedColumns(field, derivedRows);

    return (
      <div key={field.id} className="repeatable-group">
        <div className="repeatable-group-title">
          <span>{field.label}</span>
          {field.suffix && <span className="multiplier">{field.suffix}</span>}
        </div>
        <div className="repeatable-group-table">
          <div className="repeatable-group-header">
            <div className="repeatable-group-row-label">
              {field.rowLabel || 'Row'}
            </div>
            {supportedFields.map((childField: any) => (
              <div
                key={childField.id}
                className="repeatable-group-column-label"
              >
                {childField.label}
              </div>
            ))}
            {derivedColumns.map((column) => (
              <div key={column.key} className="repeatable-group-column-label">
                {column.label}
              </div>
            ))}
          </div>
          {rows.map((row, rowIndex) => (
            <div key={rowIndex} className="repeatable-group-row">
              <div className="repeatable-group-row-label">
                {field.rowLabel || 'Row'} {rowIndex + 1}
              </div>
              {supportedFields.map((childField: any) => (
                <div key={childField.id} className="repeatable-group-control">
                  <label className="repeatable-group-mobile-label">
                    {childField.label}
                  </label>
                  {renderRepeatableGroupInput(
                    field,
                    rowIndex,
                    childField,
                    row[childField.id],
                  )}
                </div>
              ))}
              {derivedColumns.map((column) => (
                <div key={column.key} className="repeatable-group-control">
                  <label className="repeatable-group-mobile-label">
                    {column.label}
                  </label>
                  <div className="calculated-value" style={{ width: 'auto' }}>
                    {renderDerivedValue(
                      derivedRows[rowIndex]?.[column.key],
                      column.key,
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderRepeatableGroupInput = (
    field: any,
    rowIndex: number,
    childField: any,
    value: any,
  ) => {
    const disabled = isReadOnly || childField.autoPopulated;

    if (childField.type === 'text') {
      return (
        <input
          type="text"
          className="score-input repeatable-group-input"
          placeholder={childField.placeholder || ''}
          value={value ?? ''}
          onChange={(e) =>
            handleRepeatableGroupInputChange(
              field,
              rowIndex,
              childField,
              e.target.value,
            )
          }
          disabled={disabled}
        />
      );
    }

    if (childField.type === 'number') {
      return (
        <input
          type="number"
          className="score-input repeatable-group-number"
          min={childField.min ?? 0}
          max={childField.max}
          step={childField.step || 1}
          value={value ?? ''}
          placeholder={childField.placeholder || '0'}
          onChange={(e) =>
            handleRepeatableGroupInputChange(
              field,
              rowIndex,
              childField,
              e.target.value,
            )
          }
          disabled={disabled}
        />
      );
    }

    if (childField.type === 'dropdown') {
      return (
        <select
          className="score-input repeatable-group-input"
          value={value ?? ''}
          onChange={(e) =>
            handleRepeatableGroupInputChange(
              field,
              rowIndex,
              childField,
              e.target.value,
            )
          }
          disabled={disabled}
        >
          <option value="">Select...</option>
          {childField.options?.map((opt: any) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
          {value &&
            !childField.options?.some(
              (opt: any) => String(opt.value) === String(value),
            ) && <option value={value}>{value}</option>}
        </select>
      );
    }

    if (childField.type === 'buttons') {
      return (
        <div className="score-button-group repeatable-group-buttons">
          {childField.options?.map((opt: any) => (
            <button
              key={opt.value}
              type="button"
              className={`score-option-button ${String(value) === String(opt.value) ? 'selected' : ''}`}
              onClick={() =>
                handleRepeatableGroupInputChange(
                  field,
                  rowIndex,
                  childField,
                  opt.value,
                )
              }
              disabled={disabled}
            >
              {opt.label}
            </button>
          ))}
        </div>
      );
    }

    if (childField.type === 'checkbox') {
      return (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) =>
            handleRepeatableGroupInputChange(
              field,
              rowIndex,
              childField,
              e.target.checked,
            )
          }
          disabled={disabled}
        />
      );
    }

    return null;
  };

  const renderFallbackRepeatableGroup = (fieldId: string, data: any) => {
    const rows = Array.isArray(data.value) ? data.value : [];
    const derivedRows = Array.isArray(data.derived?.rows)
      ? data.derived.rows
      : [];
    const rowKeys = getRepeatableGroupRowKeys(rows);
    const derivedColumns = getRepeatableGroupDerivedColumns(
      undefined,
      derivedRows,
    );

    return (
      <div key={fieldId} className="repeatable-group">
        <div className="repeatable-group-title">{data.label || fieldId}</div>
        <div className="repeatable-group-table">
          <div className="repeatable-group-header">
            <div className="repeatable-group-row-label">Row</div>
            {rowKeys.map((key) => (
              <div key={key} className="repeatable-group-column-label">
                {key}
              </div>
            ))}
            {derivedColumns.map((column) => (
              <div key={column.key} className="repeatable-group-column-label">
                {column.label}
              </div>
            ))}
          </div>
          {rows.map((row: any, rowIndex: number) => (
            <div key={rowIndex} className="repeatable-group-row">
              <div className="repeatable-group-row-label">
                Row {rowIndex + 1}
              </div>
              {rowKeys.map((key) => (
                <div key={key} className="repeatable-group-control">
                  <label className="repeatable-group-mobile-label">{key}</label>
                  <input
                    type="text"
                    className="score-input repeatable-group-input"
                    value={String(row?.[key] ?? '')}
                    disabled
                  />
                </div>
              ))}
              {derivedColumns.map((column) => (
                <div key={column.key} className="repeatable-group-control">
                  <label className="repeatable-group-mobile-label">
                    {column.label}
                  </label>
                  <div className="calculated-value" style={{ width: 'auto' }}>
                    {renderDerivedValue(
                      derivedRows[rowIndex]?.[column.key],
                      column.key,
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
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
            .map(([fieldId, data]: [string, any]) =>
              data.type === 'repeatableGroup' || Array.isArray(data.value) ? (
                renderFallbackRepeatableGroup(fieldId, data)
              ) : (
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
                      style={{
                        width: data.type === 'number' ? '70px' : '100%',
                      }}
                    />
                  )}
                </div>
              ),
            )}
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
