import {
  normalizeLegacyScoresheetFields,
  normalizeLegacyScoresheetSchema,
  parseNormalizedScoresheetFields,
  parseNormalizedScoresheetSchema,
} from '../shared/scoresheetNormalize';
import {
  formatZodIssues,
  type ScoresheetField,
  type ScoresheetSchema,
} from '../shared/scoresheetSchema';

export interface LoadedScoresheetSchema {
  ok: boolean;
  value: ScoresheetSchema | unknown | null;
  issues?: string[];
  migrations: string[];
  jsonParseError?: string;
}

export interface LoadedScoresheetFields {
  ok: boolean;
  value: ScoresheetField[] | unknown | null;
  issues?: string[];
  migrations: string[];
  jsonParseError?: string;
}

function parseJsonText(
  text: unknown,
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (typeof text !== 'string') {
    return { ok: false, error: 'Document JSON is not a string.' };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid JSON.',
    };
  }
}

export function loadScoresheetSchemaFromText(
  text: unknown,
): LoadedScoresheetSchema {
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    return {
      ok: false,
      value: null,
      issues: [parsed.error],
      migrations: [],
      jsonParseError: parsed.error,
    };
  }

  const normalized = normalizeLegacyScoresheetSchema(parsed.value);
  const result = parseNormalizedScoresheetSchema(parsed.value);
  if (result.success) {
    return {
      ok: true,
      value: result.data,
      migrations: normalized.migrations,
    };
  }

  return {
    ok: false,
    value: parsed.value,
    issues: formatZodIssues(result.error.issues),
    migrations: normalized.migrations,
  };
}

export function loadScoresheetFieldsFromText(
  text: unknown,
): LoadedScoresheetFields {
  const parsed = parseJsonText(text);
  if (!parsed.ok) {
    return {
      ok: false,
      value: null,
      issues: [parsed.error],
      migrations: [],
      jsonParseError: parsed.error,
    };
  }

  const normalized = normalizeLegacyScoresheetFields(parsed.value);
  const result = parseNormalizedScoresheetFields(parsed.value);
  if (result.success) {
    return {
      ok: true,
      value: result.data,
      migrations: normalized.migrations,
    };
  }

  return {
    ok: false,
    value: parsed.value,
    issues: formatZodIssues(result.error.issues),
    migrations: normalized.migrations,
  };
}

export function applyLoadedSchema(template: {
  schema?: unknown;
  schemaIssues?: string[];
  schemaNormalization?: string[];
}): void {
  const loaded = loadScoresheetSchemaFromText(template.schema);
  template.schema = loaded.value;
  if (loaded.issues && loaded.issues.length > 0) {
    template.schemaIssues = loaded.issues;
  }
  if (loaded.migrations.length > 0) {
    template.schemaNormalization = loaded.migrations;
  }
}

export function applyLoadedFields(template: {
  fields_json?: unknown;
  fields?: unknown;
  fieldsIssues?: string[];
  fieldsNormalization?: string[];
}): void {
  const loaded = loadScoresheetFieldsFromText(template.fields_json);
  template.fields = loaded.value;
  if (loaded.issues && loaded.issues.length > 0) {
    template.fieldsIssues = loaded.issues;
  }
  if (loaded.migrations.length > 0) {
    template.fieldsNormalization = loaded.migrations;
  }
}
