/**
 * Canonical scoresheet document model. Types are inferred from Zod schemas.
 */
import { z, type ZodSafeParseResult } from 'zod';
import { positiveId, trimmedNonEmptyString } from './validationPrimitives';

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

const NO_DEFAULT_TYPES = new Set([
  'calculated',
  'section_header',
  'group_header',
  'winner-select',
]);

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function formatIssuePath(path: readonly PropertyKey[]): string {
  let out = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      out += `[${segment}]`;
    } else if (out.length === 0) {
      out += String(segment);
    } else {
      out += `.${String(segment)}`;
    }
  }
  return out;
}

export function formatZodIssues(issues: readonly z.core.$ZodIssue[]): string[] {
  return issues.map((issue) => {
    const path = formatIssuePath(issue.path);
    if (!path) {
      return issue.message;
    }
    return `${path}: ${issue.message}`;
  });
}

function fieldRef(
  field: { id?: string; type?: string },
  index?: number,
): string {
  if (field.id) {
    return `fields[${field.id}]`;
  }
  if (typeof index === 'number') {
    return `fields[${index}]`;
  }
  if (field.type) {
    return `fields[<${field.type}>]`;
  }
  return 'fields[?]';
}

function optionValuesMatch(
  optionValue: unknown,
  defaultValue: unknown,
): boolean {
  return Object.is(optionValue, defaultValue);
}

const scoresheetValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const scoresheetFieldOptionSchema = z.strictObject({
  label: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

const dbDataSourceSchema = z.strictObject({
  type: z.literal('db'),
  eventId: positiveId.nullable().optional(),
  labelField: z.string().optional(),
  valueField: z.string().optional(),
});

const bracketDataSourceSchema = z.strictObject({
  type: z.literal('bracket'),
  sheetName: z.string().optional(),
});

const sheetsDataSourceSchema = z.strictObject({
  sheetName: z.string(),
  range: z.string().optional(),
  labelField: z.string().optional(),
  valueField: z.string().optional(),
});

export const dataSourceSchema = z.union([
  dbDataSourceSchema,
  bracketDataSourceSchema,
  sheetsDataSourceSchema,
]);

const cascadeFormatASchema = z.strictObject({
  targetField: trimmedNonEmptyString,
  sourceField: trimmedNonEmptyString,
});

const cascadeFormatBSchema = z.record(z.string(), z.string());

export const cascadesSchema = z.union([
  cascadeFormatASchema,
  cascadeFormatBSchema,
]);

const derivedOutputsSchema = z
  .strictObject({
    sortedEquivalent: z.string().optional(),
    unsortedEquivalent: z.string().optional(),
    subtotal: z.string().optional(),
  })
  .optional();

export const derivedConfigSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('botballCubeStacks'),
    sortedValue: z.number(),
    unsortedValue: z.number(),
    outputs: derivedOutputsSchema,
  }),
  z.strictObject({
    type: z.literal('botballStartBoxCubes'),
    outputs: derivedOutputsSchema,
  }),
]);

const dbBracketSourceSchema = z.strictObject({
  type: z.literal('db'),
  scope: z.literal('event').optional(),
  eventId: positiveId.nullable().optional(),
  bracketId: positiveId.nullable().optional(),
});

const sheetsBracketSourceSchema = z.strictObject({
  sheetName: z.string(),
  purpose: z.string().optional(),
});

export const bracketSourceSchema = z.union([
  dbBracketSourceSchema,
  sheetsBracketSourceSchema,
]);

const dbTeamsDataSourceSchema = z.strictObject({
  type: z.literal('db'),
  eventId: positiveId.nullable().optional(),
  teamNumberField: z.string().optional(),
  teamNameField: z.string().optional(),
});

const sheetsTeamsDataSourceSchema = z.strictObject({
  sheetName: z.string(),
  teamNumberField: z.string().optional(),
  teamNameField: z.string().optional(),
});

export const teamsDataSourceSchema = z.union([
  dbTeamsDataSourceSchema,
  sheetsTeamsDataSourceSchema,
]);

const fieldBase = {
  id: trimmedNonEmptyString,
  label: trimmedNonEmptyString,
  required: z.boolean().optional(),
  description: z.string().optional(),
  placeholder: z.string().optional(),
  column: z.string().optional(),
  autoPopulated: z.boolean().optional(),
  suffix: z.string().optional(),
} as const;

export const textFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('text'),
  defaultValue: z
    .string({ error: 'defaultValue must be a string for text fields.' })
    .optional(),
});

export const numberFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('number'),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().optional(),
  isMultiplier: z.boolean().optional(),
  defaultValue: z
    .number({
      error: 'defaultValue must be a finite number for number fields.',
    })
    .finite({
      error: 'defaultValue must be a finite number for number fields.',
    })
    .optional(),
});

export const dropdownFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('dropdown'),
  options: z.array(scoresheetFieldOptionSchema).optional(),
  dataSource: dataSourceSchema.optional(),
  cascades: cascadesSchema.optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const buttonsFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('buttons'),
  options: z.array(scoresheetFieldOptionSchema).min(1),
  isMultiplier: z.boolean().optional(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const checkboxFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('checkbox'),
  checkboxLabel: z.string().optional(),
  defaultValue: z
    .boolean({
      error: 'defaultValue must be a boolean for checkbox fields.',
    })
    .optional(),
});

export const calculatedFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('calculated'),
  formula: trimmedNonEmptyString,
  isGrandTotal: z.boolean().optional(),
  isTotal: z.boolean().optional(),
  defaultValue: z.unknown().optional(),
});

export const sectionHeaderFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('section_header'),
  defaultValue: z.unknown().optional(),
});

export const groupHeaderFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('group_header'),
  defaultValue: z.unknown().optional(),
});

export const winnerSelectFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('winner-select'),
  options: z.array(scoresheetFieldOptionSchema).optional(),
  defaultValue: z.unknown().optional(),
});

export const repeatableGroupChildSchema = z.discriminatedUnion('type', [
  textFieldSchema,
  numberFieldSchema,
  dropdownFieldSchema,
  buttonsFieldSchema,
  checkboxFieldSchema,
]);

export const repeatableGroupFieldSchema = z.strictObject({
  ...fieldBase,
  type: z.literal('repeatableGroup'),
  fields: z.array(repeatableGroupChildSchema),
  minRows: z.number().int().nonnegative().optional(),
  maxRows: z.number().int().nonnegative().optional(),
  autoAppendBlankRow: z.boolean().optional(),
  pruneBlankRows: z.boolean().optional(),
  rowLabel: z.string().optional(),
  derived: derivedConfigSchema.optional(),
  defaultValue: z.array(z.record(z.string(), scoresheetValueSchema)).optional(),
});

export const scoresheetFieldSchema = z.discriminatedUnion('type', [
  textFieldSchema,
  numberFieldSchema,
  dropdownFieldSchema,
  buttonsFieldSchema,
  checkboxFieldSchema,
  calculatedFieldSchema,
  sectionHeaderFieldSchema,
  groupHeaderFieldSchema,
  winnerSelectFieldSchema,
  repeatableGroupFieldSchema,
]);

export const scoresheetLayoutSchema = z.string().min(1);
export const scoresheetModeSchema = z.enum(['head-to-head']);
export const scoreKindSchema = z.enum(['double_seeding']);
export const scoreDestinationSchema = z.enum(['db']);

type AnyField = z.infer<typeof scoresheetFieldSchema>;
type RepeatableChild = z.infer<typeof repeatableGroupChildSchema>;

function addIssue(
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  message: string,
): void {
  ctx.addIssue({
    code: 'custom',
    path,
    message,
  });
}

function refineNumericConstraints(
  field: Extract<AnyField, { type: 'number' }>,
  ctx: z.RefinementCtx,
  path: PropertyKey[],
): void {
  if (
    field.min !== undefined &&
    field.max !== undefined &&
    field.min > field.max
  ) {
    addIssue(ctx, [...path, 'min'], 'min must be less than or equal to max.');
  }
  if (field.step !== undefined && field.step <= 0) {
    addIssue(ctx, [...path, 'step'], 'step must be greater than 0.');
  }
}

function refineDefaultValue(
  field: AnyField | RepeatableChild,
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  label: string,
): void {
  if (!('defaultValue' in field) || field.defaultValue === undefined) {
    return;
  }

  if (NO_DEFAULT_TYPES.has(field.type)) {
    addIssue(
      ctx,
      [...path, 'defaultValue'],
      `${label}: field type "${field.type}" does not support defaultValue.`,
    );
    return;
  }

  const defaultValue = field.defaultValue;

  switch (field.type) {
    case 'number': {
      if (
        field.min !== undefined &&
        typeof defaultValue === 'number' &&
        defaultValue < field.min
      ) {
        addIssue(
          ctx,
          [...path, 'defaultValue'],
          `${label}: defaultValue ${defaultValue} is below min ${field.min}.`,
        );
      }
      if (
        field.max !== undefined &&
        typeof defaultValue === 'number' &&
        defaultValue > field.max
      ) {
        addIssue(
          ctx,
          [...path, 'defaultValue'],
          `${label}: defaultValue ${defaultValue} is above max ${field.max}.`,
        );
      }
      break;
    }
    case 'dropdown':
    case 'buttons': {
      const options = 'options' in field ? field.options : undefined;
      if (Array.isArray(options) && options.length > 0) {
        const match = options.some((opt) =>
          optionValuesMatch(opt.value, defaultValue),
        );
        if (!match) {
          addIssue(
            ctx,
            [...path, 'defaultValue'],
            `${label}: defaultValue must match one of the declared options.`,
          );
        }
      }
      break;
    }
    case 'repeatableGroup': {
      const rows = field.defaultValue;
      if (!Array.isArray(rows)) {
        break;
      }
      const childById = new Map(
        field.fields.map((child) => [child.id, child] as const),
      );
      rows.forEach((row, rowIndex) => {
        Object.entries(row).forEach(([childId, childValue]) => {
          const childField = childById.get(childId);
          if (!childField) {
            addIssue(
              ctx,
              [...path, 'defaultValue', rowIndex, childId],
              `${label}.defaultValue[${rowIndex}].${childId}: unknown child field id.`,
            );
            return;
          }
          const childWithDefault = {
            ...childField,
            defaultValue: childValue,
          } as RepeatableChild;
          refineDefaultValue(
            childWithDefault,
            ctx,
            [...path, 'defaultValue', rowIndex, childId],
            `${label}.defaultValue[${rowIndex}].${childId}`,
          );
        });
      });
      break;
    }
    default:
      break;
  }
}

function refineDropdownSource(
  field: Extract<AnyField, { type: 'dropdown' }>,
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  label: string,
): void {
  const hasOptions = Array.isArray(field.options) && field.options.length > 0;
  const hasDataSource = field.dataSource != null;
  if (!hasOptions && !hasDataSource) {
    addIssue(
      ctx,
      [...path, 'options'],
      `${label}: dropdown fields require static options or a dataSource.`,
    );
  }
}

function refineCascadesShape(
  field: Extract<AnyField, { type: 'dropdown' }>,
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  label: string,
): void {
  const cascades = field.cascades;
  if (!cascades || Array.isArray(cascades) || typeof cascades !== 'object') {
    return;
  }
  const hasTarget = 'targetField' in cascades;
  const hasSource = 'sourceField' in cascades;
  if (hasTarget !== hasSource) {
    addIssue(
      ctx,
      [...path, 'cascades'],
      `${label}: cascade format A requires both targetField and sourceField.`,
    );
  }
}

function refineRepeatableLimits(
  field: Extract<AnyField, { type: 'repeatableGroup' }>,
  ctx: z.RefinementCtx,
  path: PropertyKey[],
): void {
  if (
    field.minRows !== undefined &&
    field.maxRows !== undefined &&
    field.minRows > field.maxRows
  ) {
    addIssue(
      ctx,
      [...path, 'minRows'],
      'minRows must be less than or equal to maxRows.',
    );
  }
}

function refineUniqueIds(
  fields: Array<{ id: string }>,
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  scope: string,
): void {
  const seen = new Map<string, number>();
  fields.forEach((field, index) => {
    const previous = seen.get(field.id);
    if (previous !== undefined) {
      addIssue(
        ctx,
        [...path, index, 'id'],
        `id "${field.id}" is not unique ${scope}.`,
      );
    } else {
      seen.set(field.id, index);
    }
  });
}

function refineFieldNode(
  field: AnyField | RepeatableChild,
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  index?: number,
): void {
  const label = fieldRef(field, index);
  refineDefaultValue(field, ctx, path, label);

  if (field.type === 'number') {
    refineNumericConstraints(field, ctx, path);
  }
  if (field.type === 'dropdown') {
    refineDropdownSource(field, ctx, path, label);
    refineCascadesShape(field, ctx, path, label);
  }
  if (field.type === 'repeatableGroup') {
    refineRepeatableLimits(field, ctx, path);
    refineUniqueIds(
      field.fields,
      ctx,
      [...path, 'fields'],
      'within this repeatable group',
    );
    field.fields.forEach((child, childIndex) => {
      refineFieldNode(child, ctx, [...path, 'fields', childIndex], childIndex);
    });
  }
}

function compatibleDerivedOutput(field: AnyField | undefined): boolean {
  return field?.type === 'number' || field?.type === 'calculated';
}

function refineDerivedOutputs(fields: AnyField[], ctx: z.RefinementCtx): void {
  const byId = new Map(fields.map((field) => [field.id, field] as const));
  fields.forEach((field, index) => {
    if (field.type !== 'repeatableGroup' || field.derived?.outputs == null) {
      return;
    }
    const outputs = field.derived.outputs;
    (['sortedEquivalent', 'unsortedEquivalent', 'subtotal'] as const).forEach(
      (key) => {
        const targetId = outputs[key];
        if (!targetId) {
          return;
        }
        const target = byId.get(targetId);
        if (!target) {
          addIssue(
            ctx,
            ['fields', index, 'derived', 'outputs', key],
            `derived output "${key}" points to unknown field "${targetId}".`,
          );
          return;
        }
        if (!compatibleDerivedOutput(target)) {
          addIssue(
            ctx,
            ['fields', index, 'derived', 'outputs', key],
            `derived output "${key}" must point to a number or calculated field.`,
          );
        }
      },
    );
  });
}

function refineModeSource(
  schema: {
    mode?: 'head-to-head';
    scoreKind?: 'double_seeding';
  },
  ctx: z.RefinementCtx,
): void {
  if (schema.mode === 'head-to-head' && schema.scoreKind === 'double_seeding') {
    addIssue(
      ctx,
      ['scoreKind'],
      'scoreKind "double_seeding" cannot be combined with mode "head-to-head".',
    );
  }
}

function refineFieldCollection(
  fields: AnyField[],
  ctx: z.RefinementCtx,
  pathPrefix: PropertyKey[],
): void {
  refineUniqueIds(fields, ctx, pathPrefix, 'within this schema');
  fields.forEach((field, index) => {
    refineFieldNode(field, ctx, [...pathPrefix, index], index);
  });
}

export const scoresheetFieldsSchema = z
  .array(scoresheetFieldSchema)
  .superRefine((fields, ctx) => {
    refineFieldCollection(fields, ctx, []);
  });

export const scoresheetSchema = z
  .strictObject({
    schemaVersion: z.literal(SCORESHEET_SCHEMA_VERSION),
    title: z.string().optional(),
    description: z.string().optional(),
    layout: scoresheetLayoutSchema.optional(),
    mode: scoresheetModeSchema.optional(),
    scoreKind: scoreKindSchema.optional(),
    eventId: positiveId.nullable().optional(),
    scoreDestination: scoreDestinationSchema.optional(),
    bracketSource: bracketSourceSchema.optional(),
    teamsDataSource: teamsDataSourceSchema.optional(),
    gameAreasImage: z.string().optional(),
    fields: z.array(scoresheetFieldSchema),
  })
  .superRefine((schema, ctx) => {
    refineFieldCollection(schema.fields, ctx, ['fields']);
    refineDerivedOutputs(schema.fields, ctx);
    refineModeSource(schema, ctx);
  });

export type ScoresheetFieldOption = z.infer<typeof scoresheetFieldOptionSchema>;
export type TextField = z.infer<typeof textFieldSchema>;
export type NumberField = z.infer<typeof numberFieldSchema>;
export type DropdownField = z.infer<typeof dropdownFieldSchema>;
export type ButtonsField = z.infer<typeof buttonsFieldSchema>;
export type CheckboxField = z.infer<typeof checkboxFieldSchema>;
export type CalculatedField = z.infer<typeof calculatedFieldSchema>;
export type SectionHeaderField = z.infer<typeof sectionHeaderFieldSchema>;
export type GroupHeaderField = z.infer<typeof groupHeaderFieldSchema>;
export type WinnerSelectField = z.infer<typeof winnerSelectFieldSchema>;
export type RepeatableGroupField = z.infer<typeof repeatableGroupFieldSchema>;
export type ScoresheetField = z.infer<typeof scoresheetFieldSchema>;
export type ScoresheetFieldType = ScoresheetField['type'];
export type ScoresheetSchema = z.infer<typeof scoresheetSchema>;

export interface ScoresheetTemplate {
  name?: string;
  description?: string;
  schema: ScoresheetSchema;
}

export interface ScoreFieldEntry {
  label?: string;
  type?: ScoresheetFieldType;
  value: unknown;
  derived?: RepeatableGroupDerivedResult;
}

export function parseScoresheetFields(
  input: unknown,
): ZodSafeParseResult<ScoresheetField[]> {
  return scoresheetFieldsSchema.safeParse(input);
}

export function parseScoresheetSchema(
  input: unknown,
): ZodSafeParseResult<ScoresheetSchema> {
  const shape = discriminateShape(input);
  if (shape === 'wrapper' && isPlainObject(input)) {
    return scoresheetSchema.safeParse(input.schema);
  }
  return scoresheetSchema.safeParse(input);
}

function toValidationResult<T>(
  result: ZodSafeParseResult<T>,
): SchemaValidationResult {
  return result.success
    ? { ok: true, errors: [] }
    : { ok: false, errors: formatZodIssues(result.error.issues) };
}

export function validateScoresheetFields(
  fields: unknown,
): SchemaValidationResult {
  if (!Array.isArray(fields)) {
    return { ok: false, errors: ['fields must be an array.'] };
  }
  return toValidationResult(parseScoresheetFields(fields));
}

export function validateScoresheetSchema(
  input: unknown,
): SchemaValidationResult {
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['schema must be an object.'] };
  }
  return toValidationResult(parseScoresheetSchema(input));
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
