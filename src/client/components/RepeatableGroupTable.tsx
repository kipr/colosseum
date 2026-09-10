/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from 'react';

export interface RepeatableGroupDerivedColumn {
  key: string;
  label: string;
}

const REPEATABLE_GROUP_CONTROL_TYPES = new Set([
  'text',
  'number',
  'dropdown',
  'buttons',
  'checkbox',
]);

export function getSupportedRepeatableGroupFields(field: any) {
  return (field?.fields || []).filter((childField: any) =>
    REPEATABLE_GROUP_CONTROL_TYPES.has(childField.type),
  );
}

export function renderRepeatableGroupDerivedValue(
  value: any,
  columnKey: string,
): ReactNode {
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
}

interface RepeatableGroupTableProps {
  field: any;
  rows: Array<Record<string, any>>;
  supportedFields?: any[];
  derivedColumns?: RepeatableGroupDerivedColumn[];
  derivedRows?: any[];
  renderControl: (childField: any, value: any, rowIndex: number) => ReactNode;
}

export default function RepeatableGroupTable({
  field,
  rows,
  supportedFields = getSupportedRepeatableGroupFields(field),
  derivedColumns = [],
  derivedRows = [],
  renderControl,
}: RepeatableGroupTableProps) {
  const rowLabel = field.rowLabel || 'Row';

  return (
    <div className="repeatable-group">
      <div className="repeatable-group-title">
        <span>{field.label}</span>
        {field.suffix && <span className="multiplier">{field.suffix}</span>}
      </div>
      <div className="repeatable-group-table">
        <div className="repeatable-group-header">
          <div className="repeatable-group-row-label">{rowLabel}</div>
          {supportedFields.map((childField: any) => (
            <div key={childField.id} className="repeatable-group-column-label">
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
              {rowLabel} {rowIndex + 1}
            </div>
            {supportedFields.map((childField: any) => (
              <div key={childField.id} className="repeatable-group-control">
                <label className="repeatable-group-mobile-label">
                  {childField.label}
                </label>
                {renderControl(childField, row?.[childField.id], rowIndex)}
              </div>
            ))}
            {derivedColumns.map((column) => (
              <div key={column.key} className="repeatable-group-control">
                <label className="repeatable-group-mobile-label">
                  {column.label}
                </label>
                <div className="calculated-value" style={{ width: 'auto' }}>
                  {renderRepeatableGroupDerivedValue(
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
}
