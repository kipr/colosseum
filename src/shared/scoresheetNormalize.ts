/**
 * Deterministic legacy → canonical scoresheet transforms.
 * The canonical Zod parser stays strict; this layer runs at boundaries.
 */
import { z, type ZodSafeParseResult } from 'zod';
import {
  discriminateShape,
  isPlainObject,
  SCORESHEET_SCHEMA_VERSION,
  scoresheetFieldsSchema,
  scoresheetSchema,
  type ScoresheetField,
  type ScoresheetSchema,
} from './scoresheetSchema';

export const MIGRATION_UNWRAP_WRAPPER = 'unwrap-wrapper';
export const MIGRATION_ADD_SCHEMA_VERSION = 'add-schema-version';
export const MIGRATION_NORMALIZE_BRACKET_SOURCE_TRUE =
  'normalize-bracket-source-true';

const CANONICAL_TRUE_BRACKET_SOURCE = { type: 'db' } as const;

export interface NormalizeResult {
  value: unknown;
  migrations: string[];
}

function cloneUnknown(input: unknown): unknown {
  if (input === undefined) {
    return undefined;
  }
  return structuredClone(input);
}

export function normalizeLegacyScoresheetSchema(
  input: unknown,
): NormalizeResult {
  const migrations: string[] = [];
  let value = cloneUnknown(input);
  const shape = discriminateShape(value);

  if (shape === 'wrapper' && isPlainObject(value)) {
    value = value.schema;
    migrations.push(MIGRATION_UNWRAP_WRAPPER);
  }

  if (!isPlainObject(value)) {
    return { value, migrations };
  }

  if (value.schemaVersion === SCORESHEET_SCHEMA_VERSION) {
    return { value, migrations };
  }

  value.schemaVersion = SCORESHEET_SCHEMA_VERSION;
  migrations.push(MIGRATION_ADD_SCHEMA_VERSION);

  if (value.bracketSource === true) {
    value.bracketSource = { ...CANONICAL_TRUE_BRACKET_SOURCE };
    migrations.push(MIGRATION_NORMALIZE_BRACKET_SOURCE_TRUE);
  }

  return { value, migrations };
}

export function normalizeLegacyScoresheetFields(
  input: unknown,
): NormalizeResult {
  return { value: cloneUnknown(input), migrations: [] };
}

export function parseNormalizedScoresheetSchema(
  input: unknown,
): ZodSafeParseResult<ScoresheetSchema> {
  const { value } = normalizeLegacyScoresheetSchema(input);
  return scoresheetSchema.safeParse(value);
}

export function parseNormalizedScoresheetFields(
  input: unknown,
): ZodSafeParseResult<ScoresheetField[]> {
  const { value } = normalizeLegacyScoresheetFields(input);
  return scoresheetFieldsSchema.safeParse(value);
}

export const normalizedScoresheetSchema = z.preprocess(
  (input) => normalizeLegacyScoresheetSchema(input).value,
  scoresheetSchema,
);

export const normalizedScoresheetFieldsSchema = z.preprocess(
  (input) => normalizeLegacyScoresheetFields(input).value,
  scoresheetFieldsSchema,
);
