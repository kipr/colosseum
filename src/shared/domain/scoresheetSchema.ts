import { z } from 'zod';

/**
 * Canonical scoresheet schema model. Used by:
 * - the judge-facing form (`ScoresheetForm`)
 * - the admin score viewer (`ScoreViewModal`)
 * - the admin template preview (`TemplatePreviewModal`)
 * - the schema factories in `scoresheetUtils` and the `ScoreSheetWizard`
 *
 * Every field is parsed through this module on save (server-side rejection of
 * invalid schemas) and through `tryParseScoresheetSchema` on read (forgiving:
 * legacy rows are still surfaced to the UI, with a logged warning).
 */

export const FIELD_TYPES = [
  'text',
  'number',
  'dropdown',
  'buttons',
  'checkbox',
  'calculated',
  'section_header',
  'group_header',
  'winner-select',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

const optionSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
});
export type ScoresheetFieldOption = z.infer<typeof optionSchema>;

const dbDataSourceSchema = z.object({
  type: z.literal('db'),
  eventId: z.number().nullable().optional(),
  labelField: z.string().optional(),
  valueField: z.string().optional(),
  teamNumberField: z.string().optional(),
  teamNameField: z.string().optional(),
});

const bracketDataSourceSchema = z.object({
  type: z.literal('bracket'),
});

const dataSourceSchema = z.discriminatedUnion('type', [
  dbDataSourceSchema,
  bracketDataSourceSchema,
]);
export type ScoresheetDataSource = z.infer<typeof dataSourceSchema>;

const dbBracketSourceSchema = z.object({
  type: z.literal('db'),
  scope: z.literal('event').optional(),
  eventId: z.number().nullable().optional(),
  bracketId: z.number().nullable().optional(),
});

const baseFieldShape = {
  id: z.string(),
  label: z.string(),
  column: z.enum(['left', 'right']).optional(),
  required: z.boolean().optional(),
  autoPopulated: z.boolean().optional(),
  placeholder: z.string().optional(),
  description: z.string().optional(),
  defaultValue: z.unknown().optional(),
  startValue: z.unknown().optional(),
  suffix: z.string().optional(),
  isMultiplier: z.boolean().optional(),
  isTotal: z.boolean().optional(),
  isGrandTotal: z.boolean().optional(),
  cascades: z.record(z.string(), z.string()).optional(),
  dataSource: dataSourceSchema.optional(),
};

export const scoresheetFieldSchema = z.discriminatedUnion('type', [
  z.object({ ...baseFieldShape, type: z.literal('text') }),
  z.object({
    ...baseFieldShape,
    type: z.literal('number'),
    min: z.number().optional(),
    max: z.number().optional(),
    step: z.number().optional(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal('dropdown'),
    options: z.array(optionSchema).optional(),
  }),
  z.object({
    ...baseFieldShape,
    type: z.literal('buttons'),
    options: z.array(optionSchema),
  }),
  z.object({ ...baseFieldShape, type: z.literal('checkbox') }),
  z.object({
    ...baseFieldShape,
    type: z.literal('calculated'),
    formula: z.string(),
  }),
  z.object({ ...baseFieldShape, type: z.literal('section_header') }),
  z.object({ ...baseFieldShape, type: z.literal('group_header') }),
  z.object({
    ...baseFieldShape,
    type: z.literal('winner-select'),
    options: z.array(optionSchema).optional(),
  }),
]);
export type ScoresheetField = z.infer<typeof scoresheetFieldSchema>;

export const scoresheetSchema = z.object({
  title: z.string().optional(),
  layout: z.enum(['single-column', 'two-column']).optional(),
  mode: z.enum(['head-to-head']).optional(),
  eventId: z.number().nullable().optional(),
  scoreDestination: z.enum(['db', 'spreadsheet']).optional(),
  bracketSource: dbBracketSourceSchema.optional(),
  teamsDataSource: dbDataSourceSchema.optional(),
  gameAreasImage: z.string().optional(),
  fields: z.array(scoresheetFieldSchema),
});
export type ScoresheetSchema = z.infer<typeof scoresheetSchema>;

/**
 * Strict parse. Throws `ZodError` on any deviation. Use this on the write path
 * (template create/update) so we never persist a schema we cannot render.
 */
export function parseScoresheetSchema(raw: unknown): ScoresheetSchema {
  return scoresheetSchema.parse(raw);
}

export type TryParseResult =
  | { ok: true; value: ScoresheetSchema }
  | { ok: false; error: z.ZodError };

/**
 * Forgiving parse for the read path. Callers can decide whether to surface the
 * raw object anyway (legacy rows) while still logging the validation error.
 */
export function tryParseScoresheetSchema(raw: unknown): TryParseResult {
  const result = scoresheetSchema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error };
}
