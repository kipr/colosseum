import {
  discriminateShape,
  validateScoresheetFields,
  validateScoresheetSchema,
} from '../../shared/scoresheetSchema';
import {
  HEADER_FIELD_TYPES,
  KNOWN_FIELD_KEY_SET,
  KNOWN_SCHEMA_KEY_SET,
} from './knownKeys';
import type {
  DocumentKind,
  DocumentShape,
  InventoryFinding,
  PropertyInventory,
  RowReport,
} from './report';
import { emptyPropertyInventory } from './report';

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export { discriminateShape };

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function kindFromShape(shape: DocumentShape): DocumentKind {
  return shape === 'bare_field_array'
    ? 'field_template'
    : 'scoresheet_template';
}

function finding(
  path: string,
  code: string,
  message: string,
  candidateMigration: string | null = null,
): InventoryFinding {
  return { path, code, message, candidateMigration };
}

function sortedUnique(values: Set<string>): string[] {
  return [...values].sort();
}

function fieldPath(
  parentPath: string,
  field: Record<string, unknown>,
  index: number,
): string {
  const key = isNonEmptyString(field.id) ? field.id : String(index);
  return parentPath ? `${parentPath}.fields[${key}]` : `fields[${key}]`;
}

function inspectSheetsEra(
  value: unknown,
  path: string,
  findings: InventoryFinding[],
): void {
  if (!isPlainObject(value)) {
    return;
  }
  if ('sheetName' in value || 'range' in value) {
    findings.push(
      finding(
        path,
        'legacy.sheetsDataSource',
        'Sheets-era sheetName/range is present.',
        'normalize-sheets-datasource',
      ),
    );
  }
}

function inspectCascades(
  value: unknown,
  path: string,
  findings: InventoryFinding[],
): void {
  if (!isPlainObject(value)) {
    return;
  }
  if ('targetField' in value || 'sourceField' in value) {
    findings.push(
      finding(
        path,
        'legacy.cascadeFormatA',
        'Cascade uses { targetField, sourceField }.',
        null,
      ),
    );
    return;
  }
  findings.push(
    finding(
      path,
      'legacy.cascadeFormatB',
      'Cascade uses a map of target field ids to dot paths.',
      'cascade-format-b',
    ),
  );
}

function inspectBracketSource(
  value: unknown,
  path: string,
  findings: InventoryFinding[],
): void {
  if (value === true) {
    findings.push(
      finding(
        path,
        'legacy.bracketSourceTrue',
        'bracketSource is the boolean true rather than an object.',
        'normalize-bracket-source-true',
      ),
    );
    return;
  }
  if (!isPlainObject(value)) {
    return;
  }
  if (value.bracketId != null) {
    findings.push(
      finding(
        path,
        'legacy.bracketId',
        'bracketSource.bracketId is present.',
        'preserve-bracket-id',
      ),
    );
  }
  inspectSheetsEra(value, path, findings);
}

function walkFields(
  fields: unknown[],
  parentPath: string,
  findings: InventoryFinding[],
  fieldKeys: Set<string>,
  unknownFieldKeys: Set<string>,
): void {
  fields.forEach((field, index) => {
    if (!isPlainObject(field)) {
      const path = parentPath
        ? `${parentPath}.fields[${index}]`
        : `fields[${index}]`;
      findings.push(
        finding(path, 'shape.unknown', 'Field entry is not an object.', null),
      );
      return;
    }

    const path = fieldPath(parentPath, field, index);
    const type = typeof field.type === 'string' ? field.type : undefined;
    const isHeader = type != null && HEADER_FIELD_TYPES.has(type);

    for (const key of Object.keys(field)) {
      fieldKeys.add(key);
      if (!KNOWN_FIELD_KEY_SET.has(key)) {
        unknownFieldKeys.add(key);
        findings.push(
          finding(
            `${path}.${key}`,
            'unknown.fieldKey',
            `Field property "${key}" is not in the §1 inventory.`,
            null,
          ),
        );
      }
    }

    if (!isNonEmptyString(field.id)) {
      findings.push(
        finding(
          path,
          'missing.id',
          isHeader
            ? 'Header field is missing a non-empty id.'
            : 'Scoring field is missing a non-empty id.',
          isHeader ? 'add-header-ids' : null,
        ),
      );
    }
    if (!isNonEmptyString(field.label)) {
      findings.push(
        finding(
          path,
          'missing.label',
          isHeader
            ? 'Header field is missing a non-empty label.'
            : 'Scoring field is missing a non-empty label.',
          null,
        ),
      );
    }

    if ('name' in field) {
      const missingIdOrLabel =
        !isNonEmptyString(field.id) || !isNonEmptyString(field.label);
      findings.push(
        finding(
          path,
          'legacy.fieldName',
          'Field uses a legacy "name" property.',
          missingIdOrLabel ? 'field-template-name-to-id-label' : null,
        ),
      );
    }

    if ('startValue' in field && field.startValue !== undefined) {
      findings.push(
        finding(
          path,
          'legacy.startValue',
          '"startValue" is no longer supported; use "defaultValue".',
          null,
        ),
      );
    }

    if ('dataSource' in field) {
      inspectSheetsEra(field.dataSource, `${path}.dataSource`, findings);
    }
    if ('cascades' in field) {
      inspectCascades(field.cascades, `${path}.cascades`, findings);
    }

    if (field.type === 'repeatableGroup' && Array.isArray(field.fields)) {
      walkFields(field.fields, path, findings, fieldKeys, unknownFieldKeys);
    }
  });
}

function inventorySchemaObject(
  schema: Record<string, unknown>,
  shape: DocumentShape,
  findings: InventoryFinding[],
  schemaKeys: Set<string>,
  fieldKeys: Set<string>,
  unknownSchemaKeys: Set<string>,
  unknownFieldKeys: Set<string>,
): void {
  let hasSchemaVersion = false;

  for (const key of Object.keys(schema)) {
    schemaKeys.add(key);
    if (!KNOWN_SCHEMA_KEY_SET.has(key)) {
      unknownSchemaKeys.add(key);
      findings.push(
        finding(
          key,
          'unknown.schemaKey',
          `Schema property "${key}" is not in the §1 inventory.`,
          null,
        ),
      );
    }
    if (key === 'schemaVersion') {
      hasSchemaVersion = true;
    }
  }

  if ((shape === 'schema_object' || shape === 'wrapper') && !hasSchemaVersion) {
    findings.push(
      finding(
        '',
        'missing.schemaVersion',
        'Schema object has no schemaVersion.',
        'add-schema-version',
      ),
    );
  }

  if ('queueConfig' in schema) {
    findings.push(
      finding(
        'queueConfig',
        'watch.queueConfig',
        'queueConfig is present; no in-repo producer exists.',
        'remove-queue-config',
      ),
    );
  }
  if ('useQueueForSeeding' in schema) {
    findings.push(
      finding(
        'useQueueForSeeding',
        'watch.useQueueForSeeding',
        'useQueueForSeeding is present as a schema key; no in-repo producer exists.',
        'remove-queue-config',
      ),
    );
  }

  if ('bracketSource' in schema) {
    inspectBracketSource(schema.bracketSource, 'bracketSource', findings);
  }
  if ('teamsDataSource' in schema) {
    inspectSheetsEra(schema.teamsDataSource, 'teamsDataSource', findings);
  }

  if (Array.isArray(schema.fields)) {
    walkFields(schema.fields, '', findings, fieldKeys, unknownFieldKeys);
  }
}

export interface DocumentInventory {
  shape: DocumentShape;
  findings: InventoryFinding[];
  propertyInventory: PropertyInventory;
  currentValidationErrors: string[];
}

export function inventoryDocument(input: unknown): DocumentInventory {
  const shape = discriminateShape(input);
  const findings: InventoryFinding[] = [];
  const schemaKeys = new Set<string>();
  const fieldKeys = new Set<string>();
  const unknownSchemaKeys = new Set<string>();
  const unknownFieldKeys = new Set<string>();
  let currentValidationErrors: string[] = [];

  if (shape === 'bare_field_array') {
    walkFields(input as unknown[], '', findings, fieldKeys, unknownFieldKeys);
    currentValidationErrors = validateScoresheetFields(input).errors;
  } else if (shape === 'wrapper' && isPlainObject(input)) {
    const inner = input.schema;
    if (isPlainObject(inner)) {
      inventorySchemaObject(
        inner,
        shape,
        findings,
        schemaKeys,
        fieldKeys,
        unknownSchemaKeys,
        unknownFieldKeys,
      );
      currentValidationErrors = validateScoresheetSchema(inner).errors;
    }
  } else if (isPlainObject(input)) {
    if (shape === 'unknown') {
      findings.push(
        finding(
          '',
          'shape.unknown',
          'Document is not a bare field array, wrapper, or schema object with fields.',
          null,
        ),
      );
    }
    inventorySchemaObject(
      input,
      shape,
      findings,
      schemaKeys,
      fieldKeys,
      unknownSchemaKeys,
      unknownFieldKeys,
    );
    currentValidationErrors = validateScoresheetSchema(input).errors;
  } else {
    findings.push(
      finding(
        '',
        'shape.unknown',
        'Document is not a JSON object or array.',
        null,
      ),
    );
  }

  for (const error of currentValidationErrors) {
    findings.push(finding('', 'validation.defaultValue', error, null));
  }

  return {
    shape,
    findings,
    currentValidationErrors,
    propertyInventory: {
      schemaKeys: sortedUnique(schemaKeys),
      fieldKeys: sortedUnique(fieldKeys),
      unknownSchemaKeys: sortedUnique(unknownSchemaKeys),
      unknownFieldKeys: sortedUnique(unknownFieldKeys),
    },
  };
}

export function rowFromInventory(opts: {
  kind: DocumentKind;
  id: number | string;
  name: string;
  inventory: DocumentInventory;
  eventLinks?: RowReport['eventLinks'];
  jsonParseError?: string;
}): RowReport {
  return {
    kind: opts.kind,
    id: opts.id,
    name: opts.name,
    shape: opts.inventory.shape,
    jsonParseError: opts.jsonParseError,
    eventLinks: opts.eventLinks ?? [],
    currentValidationErrors: opts.inventory.currentValidationErrors,
    findings: opts.inventory.findings,
    propertyInventory: opts.inventory.propertyInventory,
    automaticNormalizationAvailable: false,
    proposedNormalized: null,
  };
}

export function rowFromParsedDocument(opts: {
  kind?: DocumentKind;
  id: number | string;
  name: string;
  parsed: unknown;
  eventLinks?: RowReport['eventLinks'];
}): RowReport {
  const inventory = inventoryDocument(opts.parsed);
  return rowFromInventory({
    kind: opts.kind ?? kindFromShape(inventory.shape),
    id: opts.id,
    name: opts.name,
    inventory,
    eventLinks: opts.eventLinks,
  });
}

export function rowFromJsonText(opts: {
  kind: DocumentKind;
  id: number | string;
  name: string;
  jsonText: unknown;
  eventLinks?: RowReport['eventLinks'];
}): RowReport {
  if (typeof opts.jsonText !== 'string' || opts.jsonText.trim() === '') {
    const message = 'Document JSON is empty.';
    return {
      kind: opts.kind,
      id: opts.id,
      name: opts.name,
      shape: 'unparseable',
      jsonParseError: message,
      eventLinks: opts.eventLinks ?? [],
      currentValidationErrors: [],
      findings: [finding('', 'json.parse', message, null)],
      propertyInventory: emptyPropertyInventory(),
      automaticNormalizationAvailable: false,
      proposedNormalized: null,
    };
  }

  try {
    const parsed: unknown = JSON.parse(opts.jsonText);
    return rowFromParsedDocument({
      kind: opts.kind,
      id: opts.id,
      name: opts.name,
      parsed,
      eventLinks: opts.eventLinks,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid JSON.';
    return {
      kind: opts.kind,
      id: opts.id,
      name: opts.name,
      shape: 'unparseable',
      jsonParseError: message,
      eventLinks: opts.eventLinks ?? [],
      currentValidationErrors: [],
      findings: [finding('', 'json.parse', message, null)],
      propertyInventory: emptyPropertyInventory(),
      automaticNormalizationAvailable: false,
      proposedNormalized: null,
    };
  }
}
