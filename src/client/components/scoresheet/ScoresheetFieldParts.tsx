/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CSSProperties, ReactNode } from 'react';

// Presentation pieces shared by the judge form, the admin score review modal,
// and the template preview. They render already-resolved values; state,
// initialization, and submission stay with each owner. A control with no
// change callback renders disabled.

export interface ScoreOption {
  value: any;
  label: ReactNode;
}

export interface RepeatableGroupColumn {
  key: string;
  label: ReactNode;
  renderCell: (rowIndex: number) => ReactNode;
}

export interface RepeatableGroupDerivedColumnDef {
  key: string;
  label: string;
}

const REPEATABLE_GROUP_CHILD_TYPES = [
  'text',
  'number',
  'dropdown',
  'buttons',
  'checkbox',
];

export function getSupportedRepeatableChildFields(field: any): any[] {
  return (field?.fields || []).filter((childField: any) =>
    REPEATABLE_GROUP_CHILD_TYPES.includes(childField.type),
  );
}

// Derived columns shown while a group is being edited (judge form, preview).
export function getRepeatableGroupLiveDerivedColumns(
  field: any,
): RepeatableGroupDerivedColumnDef[] {
  if (field?.derived?.type === 'botballCubeStacks') {
    return [
      { key: 'sortedColor', label: 'Sorted Color' },
      { key: 'equivalent', label: 'Equivalent' },
      { key: 'subtotal', label: 'Subtotal' },
    ];
  }

  if (field?.derived?.type === 'botballStartBoxCubes') {
    return [{ key: 'subtotal', label: 'Value' }];
  }

  return [];
}

export function isCompactField(field: any): boolean {
  return (
    field.type === 'number' ||
    field.type === 'buttons' ||
    field.type === 'checkbox'
  );
}

export function getCalculatedFieldClassName(field: any): string {
  if (field.isGrandTotal) return 'grand-total-field';
  if (field.isTotal) return 'total-field';
  return 'subtotal-field';
}

export function isOptionSelected(value: any, optionValue: any): boolean {
  return value != null && String(value) === String(optionValue);
}

export function ScoresheetHeading({ field }: { field: any }) {
  return (
    <div
      className={
        field.type === 'section_header' ? 'section-header' : 'group-header'
      }
    >
      {field.label}
    </div>
  );
}

export function CalculatedField({ field, value }: { field: any; value: any }) {
  return (
    <div className={`score-field ${getCalculatedFieldClassName(field)}`}>
      <label
        className="score-label"
        style={{
          fontWeight: field.isTotal || field.isGrandTotal ? 700 : 600,
        }}
      >
        {field.label}
      </label>
      <div className="calculated-value">{value}</div>
    </div>
  );
}

export function FieldLabel({ field }: { field: any }) {
  return (
    <label className="score-label">
      {field.isMultiplier && (
        <>
          <span className="multiplier-label">Multiplier:</span>{' '}
        </>
      )}
      {field.label}
      {field.suffix && <span className="multiplier">{field.suffix}</span>}
    </label>
  );
}

export function ScoreFieldWrapper({
  field,
  children,
}: {
  field: any;
  children: ReactNode;
}) {
  const className = field.isMultiplier
    ? 'score-field multiplier-field'
    : `score-field ${isCompactField(field) ? 'compact' : ''}`;

  return (
    <div className={className}>
      <FieldLabel field={field} />
      {children}
    </div>
  );
}

export function OptionButtonGroup({
  options,
  value,
  onSelect,
  disabled,
  className,
}: {
  options?: ScoreOption[];
  value: any;
  onSelect?: (value: any) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={
        className ? `score-button-group ${className}` : 'score-button-group'
      }
    >
      {options?.map((opt, index) => (
        <button
          key={`${index}-${String(opt.value)}`}
          type="button"
          className={`score-option-button ${isOptionSelected(value, opt.value) ? 'selected' : ''}`}
          onClick={onSelect ? () => onSelect(opt.value) : undefined}
          disabled={disabled || !onSelect}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function OptionSelect({
  options,
  value,
  onChange,
  disabled,
  required,
  className = 'score-input',
  style,
  placeholder = 'Select...',
  showUnknownValue,
}: {
  options?: ScoreOption[];
  value: any;
  onChange?: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  style?: CSSProperties;
  placeholder?: string;
  // Keep a stored value visible even when the template no longer offers it.
  showUnknownValue?: boolean;
}) {
  const hasUnknownValue =
    showUnknownValue &&
    value != null &&
    value !== '' &&
    !options?.some((opt) => String(opt.value) === String(value));

  return (
    <select
      className={className}
      value={value ?? ''}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      disabled={disabled || !onChange}
      required={required}
      style={style}
    >
      <option value="">{placeholder}</option>
      {options?.map((opt, index) => (
        <option key={`${index}-${String(opt.value)}`} value={opt.value}>
          {opt.label}
        </option>
      ))}
      {hasUnknownValue && <option value={value}>{value}</option>}
    </select>
  );
}

export function RepeatableGroupDerivedValue({
  value,
  columnKey,
}: {
  value: any;
  columnKey: string;
}) {
  if (value === undefined || value === null || value === '') {
    return null;
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
    return <>{value ? 'Yes' : 'No'}</>;
  }

  return <>{String(value)}</>;
}

export function DerivedValueCell({
  value,
  columnKey,
}: {
  value: any;
  columnKey: string;
}) {
  return (
    <div className="calculated-value" style={{ width: 'auto' }}>
      <RepeatableGroupDerivedValue value={value} columnKey={columnKey} />
    </div>
  );
}

export function getRepeatableChildColumns(
  field: any,
  rows: Array<Record<string, any>>,
  renderInput: (childField: any, value: any, rowIndex: number) => ReactNode,
): RepeatableGroupColumn[] {
  return getSupportedRepeatableChildFields(field).map((childField: any) => ({
    key: `field:${childField.id}`,
    label: childField.label,
    renderCell: (rowIndex: number) =>
      renderInput(childField, rows[rowIndex]?.[childField.id], rowIndex),
  }));
}

export function getDerivedColumns(
  columns: RepeatableGroupDerivedColumnDef[],
  derivedRows: any[],
): RepeatableGroupColumn[] {
  return columns.map((column) => ({
    key: `derived:${column.key}`,
    label: column.label,
    renderCell: (rowIndex: number) => (
      <DerivedValueCell
        value={derivedRows[rowIndex]?.[column.key]}
        columnKey={column.key}
      />
    ),
  }));
}

export function RepeatableGroupTable({
  title,
  suffix,
  rowLabel,
  rowCount,
  columns,
}: {
  title: ReactNode;
  suffix?: ReactNode;
  rowLabel: string;
  rowCount: number;
  columns: RepeatableGroupColumn[];
}) {
  return (
    <div className="repeatable-group">
      <div className="repeatable-group-title">
        <span>{title}</span>
        {suffix && <span className="multiplier">{suffix}</span>}
      </div>
      <div className="repeatable-group-table">
        <div className="repeatable-group-header">
          <div className="repeatable-group-row-label">{rowLabel}</div>
          {columns.map((column) => (
            <div key={column.key} className="repeatable-group-column-label">
              {column.label}
            </div>
          ))}
        </div>
        {Array.from({ length: rowCount }, (_, rowIndex) => (
          <div key={rowIndex} className="repeatable-group-row">
            <div className="repeatable-group-row-label">
              {rowLabel} {rowIndex + 1}
            </div>
            {columns.map((column) => (
              <div key={column.key} className="repeatable-group-control">
                <label className="repeatable-group-mobile-label">
                  {column.label}
                </label>
                {column.renderCell(rowIndex)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// Text, plain number, dropdown, buttons, and checkbox cells for a repeatable
// group row. The judge form renders its own number stepper instead.
export function RepeatableGroupChildInput({
  childField,
  value,
  onChange,
  disabled,
  required,
  showUnknownValue,
}: {
  childField: any;
  value: any;
  onChange?: (value: any) => void;
  disabled?: boolean;
  required?: boolean;
  // Review of stored scores only; a judge must pick a listed option.
  showUnknownValue?: boolean;
}) {
  const isDisabled = disabled || !onChange;

  if (childField.type === 'text') {
    return (
      <input
        type="text"
        className="score-input repeatable-group-input"
        placeholder={childField.placeholder || ''}
        value={value ?? ''}
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        required={required}
        disabled={isDisabled}
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
        onChange={onChange ? (e) => onChange(e.target.value) : undefined}
        required={required}
        disabled={isDisabled}
      />
    );
  }

  if (childField.type === 'dropdown') {
    return (
      <OptionSelect
        className="score-input repeatable-group-input"
        options={childField.options}
        value={value}
        onChange={onChange}
        required={required}
        disabled={isDisabled}
        showUnknownValue={showUnknownValue}
      />
    );
  }

  if (childField.type === 'buttons') {
    return (
      <OptionButtonGroup
        className="repeatable-group-buttons"
        options={childField.options}
        value={value}
        onSelect={onChange}
        disabled={isDisabled}
      />
    );
  }

  if (childField.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        className="repeatable-group-checkbox"
        checked={!!value}
        onChange={onChange ? (e) => onChange(e.target.checked) : undefined}
        required={required}
        disabled={isDisabled}
      />
    );
  }

  return null;
}
