/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CSSProperties, FormEvent } from 'react';

export type ScoresheetNumberUi = 'native' | 'judge' | 'stepper';

export interface ScoresheetControlOption {
  label: string;
  value: any;
}

export interface ScoresheetFieldControlProps {
  field: any;
  value: any;
  onChange?: (value: any) => void;
  disabled?: boolean;
  required?: boolean;
  isCompact?: boolean;
  numberUi?: ScoresheetNumberUi;
  displayedNumberValue?: string | number;
  numberPlaceholder?: string;
  includeNumberBounds?: boolean;
  includeOrphanDropdownValue?: boolean;
  compareSelectionAsString?: boolean;
  options?: ScoresheetControlOption[];
  placeholder?: string;
  inputClassName?: string;
  numberClassName?: string;
  buttonGroupClassName?: string;
  checkboxClassName?: string;
}

export function getScoresheetNumberBounds(field: any) {
  const step = Number(field?.step || 1);

  return {
    min: Number(field?.min ?? 0),
    max:
      field?.max === undefined || field?.max === ''
        ? undefined
        : Number(field.max),
    step: Number.isNaN(step) ? 1 : step,
  };
}

function getStepPrecision(step: number) {
  const [, decimalPart = ''] = String(step).split('.');
  return decimalPart.length;
}

function clampNumberString(rawValue: string, field: any): string {
  if (rawValue === '') {
    return rawValue;
  }

  const numValue = Number(rawValue);
  if (Number.isNaN(numValue)) {
    return rawValue;
  }

  if (field.max !== undefined && numValue > field.max) {
    return String(field.max);
  }

  if (field.min !== undefined && numValue < field.min) {
    return String(field.min);
  }

  return rawValue;
}

function clampStepperValue(value: number, field: any) {
  const { min, max } = getScoresheetNumberBounds(field);
  let nextValue = value;

  if (max !== undefined && nextValue > max) {
    nextValue = max;
  }

  if (min !== undefined && nextValue < min) {
    nextValue = min;
  }

  return nextValue;
}

function sanitizeNumberInput(event: FormEvent<HTMLInputElement>) {
  const input = event.target as HTMLInputElement;
  const cursorPosition = input.selectionStart;
  const cleaned = input.value.replace(/[^0-9.-]/g, '');
  if (input.value !== cleaned) {
    input.value = cleaned;
    if (cursorPosition) {
      input.setSelectionRange(cursorPosition - 1, cursorPosition - 1);
    }
    event.preventDefault();
  }
}

function getDropdownOptions(
  field: any,
  options?: ScoresheetControlOption[],
): ScoresheetControlOption[] {
  return options ?? field.options ?? [];
}

function isOptionSelected(
  value: any,
  optionValue: any,
  compareSelectionAsString?: boolean,
) {
  return compareSelectionAsString
    ? String(value) === String(optionValue)
    : value === optionValue;
}

export default function ScoresheetFieldControl({
  field,
  value,
  onChange,
  disabled = false,
  required,
  isCompact = false,
  numberUi = 'native',
  displayedNumberValue,
  numberPlaceholder,
  includeNumberBounds = false,
  includeOrphanDropdownValue = false,
  compareSelectionAsString = false,
  options,
  placeholder,
  inputClassName,
  numberClassName,
  buttonGroupClassName,
  checkboxClassName,
}: ScoresheetFieldControlProps) {
  if (field.type === 'text') {
    return (
      <input
        type="text"
        className={inputClassName ?? 'score-input'}
        placeholder={placeholder ?? ''}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        required={required}
        disabled={disabled}
      />
    );
  }

  if (field.type === 'number') {
    if (numberUi === 'stepper') {
      const { min, max, step } = getScoresheetNumberBounds(field);
      const numericValue = Number(value);
      const hasNumericValue =
        value !== '' &&
        value !== undefined &&
        value !== null &&
        !Number.isNaN(numericValue);
      const currentNumericValue = hasNumericValue ? numericValue : min;
      const canDecrement = !disabled && currentNumericValue > min;
      const canIncrement =
        !disabled && (max === undefined || currentNumericValue < max);

      const adjust = (direction: -1 | 1) => {
        const baseValue = hasNumericValue ? numericValue : min;
        const nextValue = clampStepperValue(
          Number(
            (baseValue + step * direction).toFixed(getStepPrecision(step)),
          ),
          field,
        );
        onChange?.(String(nextValue));
      };

      return (
        <div className="repeatable-group-number-stepper">
          <button
            type="button"
            className="repeatable-group-number-stepper-button"
            onClick={() => adjust(-1)}
            disabled={!canDecrement}
            aria-label={`Decrease ${field.label}`}
          >
            -
          </button>
          <input
            type="text"
            className={numberClassName ?? 'score-input'}
            inputMode={Number.isInteger(step) ? 'numeric' : 'decimal'}
            autoComplete="off"
            spellCheck={false}
            role="spinbutton"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={hasNumericValue ? numericValue : undefined}
            value={value ?? ''}
            placeholder={numberPlaceholder ?? placeholder ?? '0'}
            onChange={(e) => {
              const newValue = e.target.value;
              if (newValue === '' || !Number.isNaN(Number(newValue))) {
                onChange?.(clampNumberString(newValue, field));
              }
            }}
            onInput={sanitizeNumberInput}
            required={required}
            disabled={disabled}
          />
          <button
            type="button"
            className="repeatable-group-number-stepper-button"
            onClick={() => adjust(1)}
            disabled={!canIncrement}
            aria-label={`Increase ${field.label}`}
          >
            +
          </button>
        </div>
      );
    }

    const numberValue =
      numberUi === 'judge'
        ? (displayedNumberValue ?? value ?? '')
        : (value ?? '');
    const numberInputProps = includeNumberBounds
      ? {
          min: field.min ?? 0,
          max: field.max,
          step: field.step || 1,
        }
      : {};

    return (
      <input
        type="number"
        className={numberClassName ?? 'score-input'}
        {...numberInputProps}
        value={numberValue}
        placeholder={
          numberUi === 'judge'
            ? (numberPlaceholder ?? placeholder ?? '')
            : placeholder
        }
        onChange={(e) => {
          const newValue = e.target.value;
          if (numberUi === 'judge') {
            if (newValue === '' || !Number.isNaN(Number(newValue))) {
              onChange?.(clampNumberString(newValue, field));
            }
            return;
          }
          onChange?.(newValue);
        }}
        onInput={numberUi === 'judge' ? sanitizeNumberInput : undefined}
        required={required}
        disabled={disabled}
      />
    );
  }

  if (field.type === 'dropdown') {
    const dropdownOptions = getDropdownOptions(field, options);
    const compactStyle: CSSProperties | undefined = isCompact
      ? {
          width: '70px',
          textAlign: 'center',
        }
      : inputClassName
        ? undefined
        : { width: '100%' };
    const className =
      inputClassName ?? `score-input${isCompact ? ' compact' : ''}`;

    return (
      <select
        className={className}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
        required={required}
        disabled={disabled}
        style={compactStyle}
      >
        <option value="">Select...</option>
        {dropdownOptions.map((opt, idx) => (
          <option key={opt.value ?? idx} value={opt.value}>
            {opt.label}
          </option>
        ))}
        {includeOrphanDropdownValue &&
          value &&
          !dropdownOptions.some(
            (opt) => String(opt.value) === String(value),
          ) && <option value={value}>{value}</option>}
      </select>
    );
  }

  if (field.type === 'buttons') {
    const buttonOptions = getDropdownOptions(field, options);

    return (
      <div className={buttonGroupClassName ?? 'score-button-group'}>
        {buttonOptions.map((opt) => (
          <button
            key={opt.value}
            type="button"
            className={`score-option-button ${
              isOptionSelected(value, opt.value, compareSelectionAsString)
                ? 'selected'
                : ''
            }`}
            onClick={() => onChange?.(opt.value)}
            disabled={disabled}
          >
            {opt.label}
          </button>
        ))}
      </div>
    );
  }

  if (field.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        className={checkboxClassName}
        checked={!!value}
        onChange={(e) => onChange?.(e.target.checked)}
        required={required}
        disabled={disabled}
      />
    );
  }

  return null;
}
