/**
 * Zod-free half of the scoresheet document model: primitive types, value
 * guards, and field helpers.
 *
 * The canonical schemas live in `./scoresheetSchema`. They are kept out of this
 * module so the browser bundle never pulls in the Zod runtime; the client
 * imports values from here and inferred types with `import type`. The type-only
 * import below is erased at compile time, so it creates no runtime cycle.
 */
import type { RepeatableGroupField } from './scoresheetSchema';

export const SCORESHEET_SCHEMA_VERSION = 1 as const;

export type ScoresheetDocumentShape =
  | 'schema_object'
  | 'bare_field_array'
  | 'wrapper'
  | 'unknown';

export interface SchemaValidationResult {
  ok: boolean;
  errors: string[];
}

export type ScoresheetValue = string | number | boolean | null;

export type RepeatableGroupRows = Record<string, ScoresheetValue>[];

export interface RepeatableGroupDerivedResult {
  rows: Array<Record<string, ScoresheetValue>>;
  sortedEquivalent?: number;
  unsortedEquivalent?: number;
  subtotal?: number;
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isScoresheetValue(value: unknown): value is ScoresheetValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

export function discriminateShape(input: unknown): ScoresheetDocumentShape {
  if (Array.isArray(input)) {
    return 'bare_field_array';
  }
  if (!isPlainObject(input)) {
    return 'unknown';
  }
  if (isPlainObject(input.schema)) {
    return 'wrapper';
  }
  if ('fields' in input) {
    return 'schema_object';
  }
  return 'unknown';
}

export function isRepeatableGroupField(
  field: unknown,
): field is RepeatableGroupField {
  return isPlainObject(field) && field.type === 'repeatableGroup';
}

export function formatSchemaValidationError(errors: string[]): string {
  if (errors.length === 1) {
    return errors[0];
  }
  return `Invalid scoresheet schema:\n${errors.map((e) => `  - ${e}`).join('\n')}`;
}

export function getFieldDefaultValue(field: unknown): unknown {
  if (!isPlainObject(field)) return undefined;
  if (!('defaultValue' in field)) return undefined;
  return field.defaultValue;
}

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
