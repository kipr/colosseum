/**
 * Official scoresheet template schema types and defaultValue validation.
 */

export type ScoresheetFieldType =
  | 'text'
  | 'number'
  | 'dropdown'
  | 'buttons'
  | 'checkbox'
  | 'calculated'
  | 'section_header'
  | 'group_header'
  | 'winner-select'
  | 'repeatableGroup';

export interface ScoresheetFieldOption {
  label: string;
  value: string | number | boolean;
}

export interface ScoresheetFieldBase {
  id?: string;
  label?: string;
  type: ScoresheetFieldType;
  required?: boolean;
  description?: string;
  placeholder?: string;
  column?: 'left' | 'right' | string;
  /** @deprecated Removed — use defaultValue. Presence is a validation error. */
  startValue?: unknown;
}

export interface TextField extends ScoresheetFieldBase {
  type: 'text';
  defaultValue?: string;
}

export interface NumberField extends ScoresheetFieldBase {
  type: 'number';
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
}

export interface DropdownField extends ScoresheetFieldBase {
  type: 'dropdown';
  options?: ScoresheetFieldOption[];
  dataSource?: Record<string, unknown>;
  defaultValue?: string | number | boolean;
}

export interface ButtonsField extends ScoresheetFieldBase {
  type: 'buttons';
  options?: ScoresheetFieldOption[];
  defaultValue?: string | number | boolean;
}

export interface CheckboxField extends ScoresheetFieldBase {
  type: 'checkbox';
  checkboxLabel?: string;
  defaultValue?: boolean;
}

export interface CalculatedField extends ScoresheetFieldBase {
  type: 'calculated';
  formula?: string;
  isGrandTotal?: boolean;
  defaultValue?: never;
}

export interface SectionHeaderField extends ScoresheetFieldBase {
  type: 'section_header';
  defaultValue?: never;
}

export interface GroupHeaderField extends ScoresheetFieldBase {
  type: 'group_header';
  defaultValue?: never;
}

export interface WinnerSelectField extends ScoresheetFieldBase {
  type: 'winner-select';
  defaultValue?: never;
}

export interface RepeatableGroupField extends ScoresheetFieldBase {
  type: 'repeatableGroup';
  fields?: ScoresheetField[];
  minRows?: number;
  maxRows?: number;
  defaultValue?: Array<Record<string, unknown>>;
}

export type ScoresheetField =
  | TextField
  | NumberField
  | DropdownField
  | ButtonsField
  | CheckboxField
  | CalculatedField
  | SectionHeaderField
  | GroupHeaderField
  | WinnerSelectField
  | RepeatableGroupField;

export interface ScoresheetSchema {
  title?: string;
  description?: string;
  layout?: string;
  mode?: string;
  scoreKind?: string;
  fields?: ScoresheetField[];
  [key: string]: unknown;
}

export interface ScoresheetTemplate {
  name?: string;
  description?: string;
  schema: ScoresheetSchema;
}

export interface SchemaValidationResult {
  ok: boolean;
  errors: string[];
}

const NO_DEFAULT_TYPES = new Set<ScoresheetFieldType>([
  'calculated',
  'section_header',
  'group_header',
  'winner-select',
]);

function fieldPath(path: string, field: { id?: string; type?: string }): string {
  if (path) return path;
  if (field.id) return `fields[${field.id}]`;
  if (field.type) return `fields[<${field.type}>]`;
  return 'fields[?]';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionValuesMatch(
  optionValue: unknown,
  defaultValue: unknown,
): boolean {
  return Object.is(optionValue, defaultValue);
}

/**
 * Resolve the canonical schema default for a field, if any.
 * The legacy `startValue` property is intentionally ignored.
 */
export function getFieldDefaultValue(field: unknown): unknown {
  if (!isPlainObject(field)) return undefined;
  if (!('defaultValue' in field)) return undefined;
  return field.defaultValue;
}

/**
 * Initial blank / reset value for an interactive field.
 * Uses `defaultValue` when present; otherwise type-based empty defaults.
 */
export function getBlankFieldValue(field: unknown): unknown {
  const defaultValue = getFieldDefaultValue(field);
  if (defaultValue !== undefined) {
    return defaultValue;
  }

  if (isPlainObject(field) && field.type === 'checkbox') {
    return false;
  }

  return '';
}

function validateDefaultValueForField(
  field: Record<string, unknown>,
  path: string,
): string[] {
  const errors: string[] = [];
  const label = fieldPath(path, field as { id?: string; type?: string });
  const type = field.type;

  if ('startValue' in field && field.startValue !== undefined) {
    errors.push(
      `${label}: "startValue" is no longer supported; use "defaultValue" instead.`,
    );
  }

  if (!('defaultValue' in field) || field.defaultValue === undefined) {
    return errors;
  }

  if (typeof type !== 'string' || type.length === 0) {
    errors.push(`${label}: fields with defaultValue must include a "type".`);
    return errors;
  }

  if (NO_DEFAULT_TYPES.has(type as ScoresheetFieldType)) {
    errors.push(
      `${label}: field type "${type}" does not support defaultValue.`,
    );
    return errors;
  }

  const defaultValue = field.defaultValue;

  switch (type) {
    case 'text': {
      if (typeof defaultValue !== 'string') {
        errors.push(`${label}: defaultValue must be a string for text fields.`);
      }
      break;
    }
    case 'number': {
      if (typeof defaultValue !== 'number' || !Number.isFinite(defaultValue)) {
        errors.push(
          `${label}: defaultValue must be a finite number for number fields.`,
        );
        break;
      }
      if (
        typeof field.min === 'number' &&
        Number.isFinite(field.min) &&
        defaultValue < field.min
      ) {
        errors.push(
          `${label}: defaultValue ${defaultValue} is below min ${field.min}.`,
        );
      }
      if (
        typeof field.max === 'number' &&
        Number.isFinite(field.max) &&
        defaultValue > field.max
      ) {
        errors.push(
          `${label}: defaultValue ${defaultValue} is above max ${field.max}.`,
        );
      }
      break;
    }
    case 'checkbox': {
      if (typeof defaultValue !== 'boolean') {
        errors.push(
          `${label}: defaultValue must be a boolean for checkbox fields.`,
        );
      }
      break;
    }
    case 'dropdown':
    case 'buttons': {
      const primitiveOk =
        typeof defaultValue === 'string' ||
        typeof defaultValue === 'number' ||
        typeof defaultValue === 'boolean';
      if (!primitiveOk) {
        errors.push(
          `${label}: defaultValue must be a string, number, or boolean for ${type} fields.`,
        );
        break;
      }

      const hasStaticOptions = Array.isArray(field.options);
      const hasDynamicSource = isPlainObject(field.dataSource);

      if (hasStaticOptions) {
        const options = field.options as unknown[];
        const match = options.some(
          (opt) =>
            isPlainObject(opt) && optionValuesMatch(opt.value, defaultValue),
        );
        if (!match) {
          errors.push(
            `${label}: defaultValue must match one of the declared options.`,
          );
        }
      } else if (!hasDynamicSource && type === 'buttons') {
        errors.push(
          `${label}: buttons fields with defaultValue require an options array.`,
        );
      }
      // Dynamic dropdowns (dataSource) only require a primitive type check.
      break;
    }
    case 'repeatableGroup': {
      if (!Array.isArray(defaultValue)) {
        errors.push(
          `${label}: defaultValue must be an array of row objects for repeatableGroup fields.`,
        );
        break;
      }

      const childFields = Array.isArray(field.fields)
        ? (field.fields as unknown[])
        : [];
      const childById = new Map<string, Record<string, unknown>>();
      childFields.forEach((child) => {
        if (isPlainObject(child) && typeof child.id === 'string') {
          childById.set(child.id, child);
        }
      });

      defaultValue.forEach((row, rowIndex) => {
        if (!isPlainObject(row)) {
          errors.push(
            `${label}.defaultValue[${rowIndex}]: each row must be an object.`,
          );
          return;
        }

        Object.entries(row).forEach(([childId, childValue]) => {
          const childField = childById.get(childId);
          if (!childField) {
            errors.push(
              `${label}.defaultValue[${rowIndex}].${childId}: unknown child field id.`,
            );
            return;
          }

          const childWithDefault = {
            ...childField,
            defaultValue: childValue,
          };
          errors.push(
            ...validateDefaultValueForField(
              childWithDefault,
              `${label}.defaultValue[${rowIndex}].${childId}`,
            ),
          );
        });
      });
      break;
    }
    default: {
      errors.push(
        `${label}: unsupported field type "${type}" for defaultValue validation.`,
      );
    }
  }

  return errors;
}

function validateFieldNode(field: unknown, path: string): string[] {
  if (!isPlainObject(field)) {
    return [];
  }

  const errors = validateDefaultValueForField(field, path);

  if (field.type === 'repeatableGroup' && Array.isArray(field.fields)) {
    field.fields.forEach((child, index) => {
      const childPath = `${fieldPath(path, field as { id?: string; type?: string })}.fields[${
        isPlainObject(child) && typeof child.id === 'string'
          ? child.id
          : index
      }]`;
      errors.push(...validateFieldNode(child, childPath));
    });
  }

  return errors;
}

/**
 * Validate defaultValue / startValue rules for a list of field definitions
 * (full schema fields or field-template arrays).
 */
export function validateScoresheetFields(fields: unknown): SchemaValidationResult {
  if (!Array.isArray(fields)) {
    return { ok: false, errors: ['fields must be an array.'] };
  }

  const errors: string[] = [];
  fields.forEach((field, index) => {
    if (!isPlainObject(field)) {
      return;
    }
    const path = `fields[${typeof field.id === 'string' ? field.id : index}]`;
    errors.push(...validateFieldNode(field, path));
  });

  return { ok: errors.length === 0, errors };
}

/**
 * Validate a scoresheet schema object with a focus on official defaultValue rules.
 * Schemas without a fields array remain accepted for backward-compatible markers
 * (e.g. mode / bracketSource inference payloads).
 */
export function validateScoresheetSchema(schema: unknown): SchemaValidationResult {
  if (!isPlainObject(schema)) {
    return { ok: false, errors: ['schema must be an object.'] };
  }

  if (!('fields' in schema) || schema.fields === undefined) {
    return { ok: true, errors: [] };
  }

  if (!Array.isArray(schema.fields)) {
    return { ok: false, errors: ['schema.fields must be an array.'] };
  }

  return validateScoresheetFields(schema.fields);
}

export function formatSchemaValidationError(errors: string[]): string {
  if (errors.length === 1) {
    return errors[0];
  }
  return `Invalid scoresheet schema:\n${errors.map((e) => `  - ${e}`).join('\n')}`;
}
