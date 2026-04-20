import React, { type ReactNode } from 'react';
import type {
  ScoresheetField as ScoresheetFieldT,
  ScoresheetFieldOption,
} from '../../../shared/domain/scoresheetSchema';
import {
  type BracketGameOption,
  formatBracketGameOptionLabel,
  getBracketGameOptionValue,
} from '../scoresheetUtils';

export type ScoresheetFieldMode = 'edit' | 'readonly' | 'preview';

export interface BracketDropdownProps {
  games: BracketGameOption[];
  eventScoped: boolean;
  selectedGameId: number | string | '';
  onSelect: (value: string) => void;
}

export interface DynamicDropdownItem {
  [key: string]: unknown;
}

export interface ScoresheetFieldProps {
  field: ScoresheetFieldT;
  mode: ScoresheetFieldMode;
  value?: unknown;
  calculatedValue?: number;
  /** Optional fallback used in `readonly`/`preview` mode for calculated fields. */
  storedCalculatedValue?: number;
  onChange?: (id: string, value: unknown, field: ScoresheetFieldT) => void;
  onNumberInputTouched?: (id: string, touched: boolean) => void;
  /** Whether the user has interacted with this number field (drives placeholder fallback). */
  touched?: boolean;
  bracket?: BracketDropdownProps;
  dynamicOptions?: DynamicDropdownItem[];
  /** Allows the parent (e.g. judge form) to inject a richer winner-select UI. */
  renderWinnerSelect?: (field: ScoresheetFieldT) => ReactNode;
}

function isCompactType(type: ScoresheetFieldT['type']): boolean {
  return type === 'number' || type === 'buttons' || type === 'checkbox';
}

function getFieldStartingValue(field: ScoresheetFieldT): unknown {
  if ('defaultValue' in field && field.defaultValue !== undefined) {
    return field.defaultValue;
  }
  return field.startValue;
}

function shouldShowNumberPlaceholder(
  field: ScoresheetFieldT,
  value: unknown,
  touched: boolean,
): boolean {
  const startingValue = getFieldStartingValue(field);
  return (
    !touched &&
    (value === '' ||
      value === undefined ||
      value === null ||
      value === 0 ||
      value === '0') &&
    (startingValue === undefined ||
      startingValue === null ||
      startingValue === '' ||
      startingValue === 0 ||
      startingValue === '0')
  );
}

function getDisplayedNumberValue(
  field: ScoresheetFieldT,
  value: unknown,
  touched: boolean,
): string {
  if (shouldShowNumberPlaceholder(field, value, touched)) {
    return '';
  }
  return value == null ? '' : String(value);
}

function getNumberPlaceholder(
  field: ScoresheetFieldT,
  value: unknown,
  touched: boolean,
  mode: ScoresheetFieldMode,
): string {
  if (!shouldShowNumberPlaceholder(field, value, touched)) {
    return field.placeholder || '';
  }
  const startingValue = getFieldStartingValue(field);
  if (
    startingValue !== undefined &&
    startingValue !== null &&
    String(startingValue) !== ''
  ) {
    return String(startingValue);
  }
  if (mode === 'preview') return field.placeholder || '0';
  return field.placeholder || '0';
}

/**
 * Single field renderer for the judge form, the admin score viewer, and the
 * template preview. Behaviour per mode:
 *
 * - `edit`: inputs accept user input. `field.autoPopulated` still disables
 *   the underlying input (matching the legacy form).
 * - `readonly`: identical DOM, but every input is disabled and no `onChange`
 *   handlers fire.
 * - `preview`: identical DOM, every input disabled, calculated fields show
 *   `0`, and inputs receive their starting/default value (or empty).
 */
export function ScoresheetField({
  field,
  mode,
  value,
  calculatedValue,
  storedCalculatedValue,
  onChange,
  onNumberInputTouched,
  touched = false,
  bracket,
  dynamicOptions,
  renderWinnerSelect,
}: ScoresheetFieldProps): React.JSX.Element | null {
  if (field.type === 'section_header') {
    return <div className="section-header">{field.label}</div>;
  }

  if (field.type === 'group_header') {
    return <div className="group-header">{field.label}</div>;
  }

  if (field.type === 'winner-select') {
    if (renderWinnerSelect) {
      return <>{renderWinnerSelect(field)}</>;
    }
    return null;
  }

  if (field.type === 'calculated') {
    const calcValue =
      calculatedValue !== undefined
        ? calculatedValue
        : (storedCalculatedValue ?? (mode === 'preview' ? 0 : 0));
    const className = field.isGrandTotal
      ? 'grand-total-field'
      : field.isTotal
        ? 'total-field'
        : 'subtotal-field';
    return (
      <div className={`score-field ${className}`}>
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

  const isCompact = isCompactType(field.type);
  const effectiveValue =
    value !== undefined
      ? value
      : mode === 'preview'
        ? getFieldStartingValue(field)
        : '';

  const wrapperClass = field.isMultiplier
    ? 'score-field multiplier-field'
    : `score-field ${isCompact ? 'compact' : ''}`;

  const labelNode = field.isMultiplier ? (
    <label className="score-label">
      <span className="multiplier-label">Multiplier:</span> {field.label}
      {field.suffix && <span className="multiplier">{field.suffix}</span>}
    </label>
  ) : (
    <label className="score-label">
      {field.label}
      {field.suffix && <span className="multiplier">{field.suffix}</span>}
    </label>
  );

  return (
    <div className={wrapperClass}>
      {labelNode}
      <FieldInput
        field={field}
        mode={mode}
        value={effectiveValue}
        touched={touched}
        isCompact={isCompact}
        onChange={onChange}
        onNumberInputTouched={onNumberInputTouched}
        bracket={bracket}
        dynamicOptions={dynamicOptions}
      />
    </div>
  );
}

interface FieldInputProps {
  field: ScoresheetFieldT;
  mode: ScoresheetFieldMode;
  value: unknown;
  touched: boolean;
  isCompact: boolean;
  onChange?: (id: string, value: unknown, field: ScoresheetFieldT) => void;
  onNumberInputTouched?: (id: string, touched: boolean) => void;
  bracket?: BracketDropdownProps;
  dynamicOptions?: DynamicDropdownItem[];
}

function FieldInput({
  field,
  mode,
  value,
  touched,
  isCompact,
  onChange,
  onNumberInputTouched,
  bracket,
  dynamicOptions,
}: FieldInputProps): React.JSX.Element | null {
  const isReadOnly = mode !== 'edit';
  const disabled =
    isReadOnly ||
    ('autoPopulated' in field && field.autoPopulated === true) ||
    mode === 'preview';

  const fire = (next: unknown) => {
    if (isReadOnly || !onChange) return;
    onChange(field.id, next, field);
  };

  // Bracket-data dropdown: special wiring for game selection.
  if (
    field.type === 'dropdown' &&
    field.dataSource?.type === 'bracket' &&
    bracket
  ) {
    const availableGames = bracket.games.filter(
      (g) => !g.hasWinner && g.team1 !== null && g.team2 !== null,
    );
    return (
      <select
        className="score-input"
        value={
          bracket.eventScoped
            ? String(bracket.selectedGameId ?? '')
            : value == null
              ? ''
              : String(value)
        }
        onChange={(e) => bracket.onSelect(e.target.value)}
        required={field.required}
        disabled={disabled}
        style={{ width: '250px' }}
      >
        <option value="">Select Game...</option>
        {availableGames.length === 0 ? (
          <option value="" disabled>
            No undecided games available
          </option>
        ) : (
          availableGames.map((game) => (
            <option
              key={game.bracketGameId ?? `${game.bracketId}-${game.gameNumber}`}
              value={getBracketGameOptionValue(game, bracket.eventScoped)}
            >
              {formatBracketGameOptionLabel(game)}
            </option>
          ))
        )}
      </select>
    );
  }

  switch (field.type) {
    case 'text':
      return (
        <input
          type="text"
          className="score-input"
          placeholder={field.placeholder || ''}
          value={value == null ? '' : String(value)}
          onChange={(e) => fire(e.target.value)}
          required={field.required}
          disabled={disabled}
        />
      );

    case 'number':
      return (
        <input
          type="number"
          className="score-input"
          min={field.min ?? 0}
          max={field.max}
          step={field.step || 1}
          value={getDisplayedNumberValue(field, value, touched)}
          placeholder={getNumberPlaceholder(field, value, touched, mode)}
          onChange={(e) => {
            if (isReadOnly) return;
            let newValue = e.target.value;
            if (newValue === '' || !isNaN(Number(newValue))) {
              const numValue = Number(newValue);
              if (
                newValue !== '' &&
                field.max !== undefined &&
                numValue > field.max
              ) {
                newValue = String(field.max);
              }
              if (
                newValue !== '' &&
                field.min !== undefined &&
                numValue < field.min
              ) {
                newValue = String(field.min);
              }
              onNumberInputTouched?.(field.id, newValue !== '');
              fire(newValue);
            }
          }}
          onInput={(e) => {
            const input = e.target as HTMLInputElement;
            const cursorPosition = input.selectionStart;
            const cleaned = input.value.replace(/[^0-9.-]/g, '');
            if (input.value !== cleaned) {
              input.value = cleaned;
              if (cursorPosition) {
                input.setSelectionRange(cursorPosition - 1, cursorPosition - 1);
              }
              e.preventDefault();
            }
          }}
          required={field.required}
          disabled={disabled}
        />
      );

    case 'dropdown': {
      const stringValue = value == null ? '' : String(value);
      const ds = field.dataSource;
      const dynamicReady = ds?.type === 'db' && Array.isArray(dynamicOptions);
      return (
        <select
          className={`score-input ${isCompact ? 'compact' : ''}`}
          value={stringValue}
          onChange={(e) => fire(e.target.value)}
          required={field.required}
          disabled={disabled}
          style={{
            width: isCompact ? '70px' : '100%',
            textAlign: isCompact ? 'center' : 'left',
          }}
        >
          <option value="">Select...</option>
          {dynamicReady && ds && ds.type === 'db'
            ? (dynamicOptions as DynamicDropdownItem[]).map((item, idx) => {
                const labelKey = ds.labelField || 'label';
                const valueKey = ds.valueField || 'value';
                return (
                  <option
                    key={idx}
                    value={item[valueKey] as string | number | undefined}
                  >
                    {String(item[labelKey] ?? '')}
                  </option>
                );
              })
            : field.options
              ? field.options.map((opt: ScoresheetFieldOption) => (
                  <option key={String(opt.value)} value={String(opt.value)}>
                    {opt.label}
                  </option>
                ))
              : null}
          {/* Allow showing a value not in the option list (e.g. legacy data) */}
          {mode !== 'edit' &&
            stringValue &&
            !field.options?.some((opt) => String(opt.value) === stringValue) &&
            !(
              dynamicReady &&
              (dynamicOptions as DynamicDropdownItem[]).some((item) => {
                const valueKey =
                  ds && ds.type === 'db' ? ds.valueField || 'value' : 'value';
                return String(item[valueKey]) === stringValue;
              })
            ) && <option value={stringValue}>{stringValue}</option>}
        </select>
      );
    }

    case 'buttons':
      return (
        <div className="score-button-group">
          {field.options.map((opt) => (
            <button
              key={String(opt.value)}
              type="button"
              className={`score-option-button ${String(value) === String(opt.value) ? 'selected' : ''}`}
              onClick={() => fire(opt.value)}
              disabled={disabled}
            >
              {opt.label}
            </button>
          ))}
        </div>
      );

    case 'checkbox':
      return (
        <input
          type="checkbox"
          checked={!!value}
          onChange={(e) => fire(e.target.checked)}
          required={field.required}
          disabled={disabled}
        />
      );

    default:
      return null;
  }
}
