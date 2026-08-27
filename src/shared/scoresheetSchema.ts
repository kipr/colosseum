/**
 * Official scoresheet template, score-data, and submission types, plus
 * dependency-free defaultValue validation for untrusted write boundaries.
 *
 * @remarks
 * The canonical types in this module are intended for template builders,
 * scoresheet renderers, administrative review, and server persistence after a
 * boundary has parsed and checked external JSON. Network bodies, database JSON
 * columns before parsing, session storage, and editor text should remain
 * `unknown` or use the explicit `Stored*` types until validation succeeds.
 */

import type { BracketResultType } from './bracketResult';

/**
 * Discriminator vocabulary for template fields and persisted score entries.
 * Use this when code handles field types generically rather than narrowing a
 * concrete {@link ScoresheetField}.
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

/**
 * Scalar value accepted by choices and ordinary judge inputs. This excludes
 * transient empty-number strings, repeatable rows, and calculated metadata.
 */
export type ScoresheetPrimitiveValue = string | number | boolean;

/** Author-facing label/value pair for dropdown and button choices. */
export interface ScoresheetFieldOption {
  label: string;
  value: ScoresheetPrimitiveValue;
}

/**
 * Properties required on every canonical field definition. Extend this base
 * when adding a field renderer so its discriminator participates in narrowing.
 * Do not use it as the type for parsed, unvalidated JSON.
 */
export interface ScoresheetFieldBase<
  TType extends ScoresheetFieldType = ScoresheetFieldType,
> {
  id: string;
  label: string;
  type: TType;
  description?: string;
  column?: 'left' | 'right';
  /** @deprecated Removed — use defaultValue. Presence is a validation error. */
  startValue?: never;
}

/** Shared authoring flags for fields that collect a judge-controlled value. */
export interface InteractiveFieldProperties {
  required?: boolean;
}

/** Free-form or auto-populated string input rendered by a scoresheet form. */
export interface TextField
  extends ScoresheetFieldBase<'text'>, InteractiveFieldProperties {
  placeholder?: string;
  autoPopulated?: boolean;
  defaultValue?: string;
}

/**
 * Numeric judge input with UI constraints and numeric defaults. Submitted and
 * persisted values for this field are expected to be actual numbers.
 */
export interface NumberField
  extends ScoresheetFieldBase<'number'>, InteractiveFieldProperties {
  placeholder?: string;
  suffix?: string;
  isMultiplier?: boolean;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
}

/**
 * Event-team lookup configuration for a dynamic dropdown. The schema-level
 * team source is preferred; `eventId` supports a deliberately foreign source.
 */
export interface DbDropdownDataSource {
  type: 'db';
  /** Overrides the schema-level teamsDataSource event for legacy/foreign fields. */
  eventId?: number;
  labelField?: string;
  valueField?: string;
}

/** Marker for the specialized bracket-game selector in head-to-head forms. */
export interface BracketDropdownDataSource {
  type: 'bracket';
}

/** Copies one property from a selected DB row into another form field. */
export interface FieldCascade {
  targetField: string;
  sourceField: string;
}

/**
 * Current bracket schemas emit this map, although bracket selection still
 * populates the standard team fields directly rather than interpreting it.
 */
export type BracketFieldCascadeMap = Record<string, string | undefined>;

interface DropdownFieldProperties
  extends ScoresheetFieldBase<'dropdown'>, InteractiveFieldProperties {
  defaultValue?: ScoresheetPrimitiveValue;
}

/** Dropdown whose choices are completely declared in the template. */
export type StaticDropdownField = DropdownFieldProperties & {
  options: ScoresheetFieldOption[];
  dataSource?: never;
  cascades?: never;
};

/** Event-backed dropdown, primarily used to choose a team during seeding. */
export type DbDropdownField = DropdownFieldProperties & {
  options?: never;
  dataSource: DbDropdownDataSource;
  cascades?: FieldCascade;
};

/** Bracket-game dropdown used only with a head-to-head schema. */
export type BracketDropdownField = DropdownFieldProperties & {
  options?: never;
  dataSource: BracketDropdownDataSource;
  cascades?: BracketFieldCascadeMap;
};

/**
 * Complete dropdown union. Renderers should narrow through `dataSource.type`
 * or the presence of `options` rather than casting source-specific properties.
 */
export type DropdownField =
  | StaticDropdownField
  | DbDropdownField
  | BracketDropdownField;

/** Single-choice button group, often used for scoring multipliers. */
export interface ButtonsField
  extends ScoresheetFieldBase<'buttons'>, InteractiveFieldProperties {
  options: ScoresheetFieldOption[];
  suffix?: string;
  isMultiplier?: boolean;
  defaultValue?: ScoresheetPrimitiveValue;
}

/** Boolean judge input, including checkbox columns in repeatable groups. */
export interface CheckboxField
  extends ScoresheetFieldBase<'checkbox'>, InteractiveFieldProperties {
  /** Passive compatibility metadata; renderers currently use `label`. */
  checkboxLabel?: string;
  defaultValue?: boolean;
}

/** Read-only numeric value computed from earlier inputs or derived outputs. */
export interface CalculatedField extends ScoresheetFieldBase<'calculated'> {
  formula: string;
  isTotal?: boolean;
  isGrandTotal?: boolean;
  defaultValue?: never;
}

/** Major visual divider, commonly separating the two sides of a field. */
export interface SectionHeaderField extends ScoresheetFieldBase<'section_header'> {
  defaultValue?: never;
}

/** Smaller visual divider for a related set of scoring inputs. */
export interface GroupHeaderField extends ScoresheetFieldBase<'group_header'> {
  defaultValue?: never;
}

/** Specialized Team A/Team B result selector for head-to-head scoring. */
export interface WinnerSelectField
  extends ScoresheetFieldBase<'winner-select'>, InteractiveFieldProperties {
  /** Stored and emitted today; winner rendering uses fixed Team A/B choices. */
  options?: ScoresheetFieldOption[];
  defaultValue?: never;
}

/**
 * Runtime-shaped repeatable row when its child tuple is unavailable. Prefer
 * {@link RepeatableGroupRowFor} when authoring code knows the child fields.
 */
export type RepeatableGroupRow = Record<string, ScoresheetPrimitiveValue>;

/** Field variants supported as columns inside a repeatable group. */
export type RepeatableGroupChildField =
  | TextField
  | NumberField
  | StaticDropdownField
  | ButtonsField
  | CheckboxField;

/** Resolves the canonical input value type for one repeatable child field. */
export type InputValueForField<TField extends RepeatableGroupChildField> =
  TField extends TextField
    ? string
    : TField extends NumberField
      ? number
      : TField extends CheckboxField
        ? boolean
        : TField extends StaticDropdownField | ButtonsField
          ? ScoresheetPrimitiveValue
          : never;

/**
 * Preserve child IDs and their value types when the field tuple is available.
 * This is the strict row type repeatable-group consumers should use.
 */
export type RepeatableGroupRowFor<
  TFields extends readonly RepeatableGroupChildField[],
> = {
  [TField in TFields[number] as TField['id']]?: InputValueForField<TField>;
};

/** Primitive configuration value accepted by any registered derivation. */
export type RepeatableGroupDerivationParameter =
  | string
  | number
  | boolean
  | null;

/** Maps derivation result names to top-level score-data field IDs. */
export type RepeatableGroupDerivationOutputs = Record<string, string>;

/**
 * Extensible configuration understood by a registered domain helper.
 * Only the registry key and output-to-score-field mapping are universal;
 * game-specific parameters deliberately remain generic primitive values.
 */
export interface RepeatableGroupDerivationConfig {
  type: string;
  outputs: RepeatableGroupDerivationOutputs;
  [parameter: string]:
    | RepeatableGroupDerivationParameter
    | RepeatableGroupDerivationOutputs;
}

/** Optional per-row display/audit metadata returned by a derivation helper. */
export type RepeatableGroupDerivedRow = Record<
  string,
  ScoresheetPrimitiveValue | null
>;

/** Numeric aggregates plus optional display metadata for each submitted row. */
export interface RepeatableGroupDerivedResult {
  rows?: RepeatableGroupDerivedRow[];
  [output: string]: number | RepeatableGroupDerivedRow[] | undefined;
}

/**
 * Table-like input for a variable number of similarly shaped rows. The child
 * tuple parameter preserves exact row types in schema builders and type tests.
 */
export interface RepeatableGroupField<
  TFields extends readonly RepeatableGroupChildField[] =
    RepeatableGroupChildField[],
> extends ScoresheetFieldBase<'repeatableGroup'> {
  fields: TFields;
  suffix?: string;
  rowLabel?: string;
  minRows?: number;
  /**
   * Supported by the schema model but not yet enforced by automatic append,
   * submission validation, or server validation. Add enforcement later.
   */
  maxRows?: number;
  autoAppendBlankRow?: boolean;
  pruneBlankRows?: boolean;
  derived?: RepeatableGroupDerivationConfig;
  defaultValue?: RepeatableGroupRowFor<TFields>[];
}

/**
 * Canonical union consumed by renderers, editors, validators, and calculators.
 * Switch on `type` for exhaustive field-specific behavior.
 */
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

/**
 * Database-backed bracket lookup for the head-to-head game selector. Event
 * scope is canonical; `bracketId` supports the existing bracket-specific path.
 */
export interface DbBracketSource {
  type: 'db';
  scope?: 'event';
  eventId?: number | null;
  bracketId?: number | null;
}

/**
 * Canonical event-team collection used to populate team identity and display
 * information across scoring archetypes.
 */
export interface DbTeamsDataSource {
  type: 'db';
  eventId: number;
  teamNumberField?: string;
  teamNameField?: string;
}

/**
 * Properties shared by every canonical scoresheet template. Use a concrete
 * schema variant when code needs archetype-specific sources.
 */
export interface ScoresheetSchemaBase {
  schemaVersion?: number;
  title?: string;
  description?: string;
  layout?: 'two-column';
  eventId?: number | null;
  scoreDestination?: 'db';
  /** Canonical event-team collection used by every scoring archetype. */
  teamsDataSource: DbTeamsDataSource;
  gameAreasImage?: string;
  fields: ScoresheetField[];
}

// TODO Unify under `kind` as sole discriminator.

/** Schema for one-team seeding runs under the transitional discriminator model. */
export interface SeedingScoresheetSchema extends ScoresheetSchemaBase {
  mode?: never;
  scoreKind?: never;
  bracketSource?: never;
}

/** Schema for two-team bracket games that produce a winner. */
export interface HeadToHeadScoresheetSchema extends ScoresheetSchemaBase {
  mode: 'head-to-head';
  scoreKind?: never;
  bracketSource: DbBracketSource;
}

/** Schema for shared two-team seeding runs with independent side totals. */
export interface DoubleSeedingScoresheetSchema extends ScoresheetSchemaBase {
  mode?: never;
  scoreKind: 'double_seeding';
  bracketSource?: never;
}

/**
 * Parsed, validated schema used by form rendering and administrative previews.
 * Keep external JSON as `unknown` until a boundary check establishes this type.
 */
export type ScoresheetSchema =
  | SeedingScoresheetSchema
  | HeadToHeadScoresheetSchema
  | DoubleSeedingScoresheetSchema;

/** Event-scoring category stored with a submission and used by acceptance. */
export type ScoreType = 'seeding' | 'bracket' | 'double_seeding';

/** Review lifecycle states for a persisted score submission. */
export type ScoreSubmissionStatus = 'pending' | 'accepted' | 'rejected';

interface ScoreValueEntryBase<TType extends string, TValue> {
  type: TType;
  value: TValue;
}

type ScoreEntryBase<TType extends string, TValue> = ScoreValueEntryBase<
  TType,
  TValue
> & { label: string };

/** Persisted value originating from a text field. */
export type TextScoreEntry = ScoreEntryBase<'text', string>;

/** Persisted value originating from a number field or server-owned numeric ID. */
export type NumberScoreEntry = ScoreEntryBase<'number', number>;

/** Persisted primitive selected from a static or dynamic dropdown. */
export type DropdownScoreEntry = ScoreEntryBase<
  'dropdown',
  ScoresheetPrimitiveValue
>;

/** Persisted primitive selected from a button group. */
export type ButtonsScoreEntry = ScoreEntryBase<
  'buttons',
  ScoresheetPrimitiveValue
>;

/** Persisted boolean supplied by a checkbox field. */
export type CheckboxScoreEntry = ScoreEntryBase<'checkbox', boolean>;

/** Persisted numeric result of formula evaluation. */
export type CalculatedScoreEntry = ScoreEntryBase<'calculated', number>;

/** Persisted logical side selected by the winner control. */
export type WinnerSelectScoreEntry = ScoreEntryBase<'winner-select', string>;

/** Persisted repeatable rows plus optional registered-derivation output. */
export type RepeatableGroupScoreEntry = ScoreEntryBase<
  'repeatableGroup',
  RepeatableGroupRow[]
> & { derived?: RepeatableGroupDerivedResult };

/**
 * Entries a judge can control directly before server-side validation and
 * canonical calculation. Server-owned IDs and calculated entries are excluded.
 */
export type JudgeSuppliedScoreEntry =
  | TextScoreEntry
  | NumberScoreEntry
  | DropdownScoreEntry
  | ButtonsScoreEntry
  | CheckboxScoreEntry
  | WinnerSelectScoreEntry
  | RepeatableGroupScoreEntry;

/** Numeric entries produced by formula or registered derivation logic. */
export type CalculatedOrDerivedScoreEntry =
  | CalculatedScoreEntry
  | NumberScoreEntry;

/** Internal boolean metadata stored alongside ordinary score entries. */
export type BooleanScoreMetadataEntry = ScoreValueEntryBase<
  'boolean',
  boolean
> & { label?: string };

/** Internal bracket-source snapshot stored alongside ordinary score entries. */
export type ObjectScoreMetadataEntry = ScoreValueEntryBase<
  'object',
  DbBracketSource | null
> & { label?: string };

/** Metadata entries added by the server rather than scoresheet fields. */
export type ServerScoreMetadataEntry =
  | BooleanScoreMetadataEntry
  | ObjectScoreMetadataEntry;

/** Any canonical entry allowed in parsed or persisted score data. */
export type ScoreEntry =
  | JudgeSuppliedScoreEntry
  | CalculatedScoreEntry
  | ServerScoreMetadataEntry;

/**
 * Canonical submission map keyed by schema field ID, including reserved server
 * metadata. This is not the type for transient React form state or raw JSON.
 */
export type ScoreData = Record<string, ScoreEntry> & {
  _isHeadToHead?: BooleanScoreMetadataEntry;
  _bracketSource?: ObjectScoreMetadataEntry;
};

/**
 * Lightweight row returned by template-list endpoints and used by judge/admin
 * selection screens that do not need the full schema.
 */
export interface ScoresheetTemplateSummary {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
  event_id?: number;
  event_name?: string;
  event_date?: string | null;
  event_status?: 'setup' | 'active' | 'complete' | 'archived';
}

/** Parsed full template returned after access verification or an admin read. */
export interface ScoresheetTemplate extends ScoresheetTemplateSummary {
  schema: ScoresheetSchema;
  access_code?: string;
  created_by?: number | null;
  is_active?: boolean;
  // TODO Should this be a date? See also `FieldTemplateSummary`
  updated_at?: string;
}

/** Database-row form used before the JSON `schema` column is parsed. */
export interface StoredScoresheetTemplate extends Omit<
  ScoresheetTemplate,
  'schema'
> {
  schema: string;
}

/** Metadata used to list reusable field templates in administrative screens. */
export interface FieldTemplateSummary {
  id: number;
  name: string;
  description: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string;
}

/** Reusable field template after `fields_json` has been parsed. */
export interface FieldTemplate extends FieldTemplateSummary {
  fields: ScoresheetField[];
  fields_json?: string;
}

/** Database-row form of a reusable field template before JSON parsing. */
export interface StoredFieldTemplate extends FieldTemplateSummary {
  fields_json: string;
}

interface ScoreSubmissionRequestBase {
  templateId: number;
  participantName: string;
  matchId: string;
  scoreData: ScoreData;
  eventId: number;
}

/** Judge API payload for one-team seeding, optionally selected from the queue. */
export interface SeedingScoreSubmissionRequest extends ScoreSubmissionRequestBase {
  scoreType: 'seeding';
  isHeadToHead: false;
  bracketSource: null;
  game_queue_id?: number;
  resultType?: 'standard';
}

/** Judge API payload for a bracket game, including result-specific metadata. */
export interface BracketScoreSubmissionRequest extends ScoreSubmissionRequestBase {
  scoreType: 'bracket';
  isHeadToHead: true;
  bracketSource: DbBracketSource;
  bracket_game_id: number;
  resultType: BracketResultType;
  disqualifiedTeamId?: number;
  resultNote?: string;
}

/** Judge API payload for a queued two-team seeding match. */
export interface DoubleSeedingScoreSubmissionRequest extends ScoreSubmissionRequestBase {
  scoreType: 'double_seeding';
  isHeadToHead: false;
  bracketSource: null;
  double_seeding_match_id: number;
  game_queue_id?: number;
  resultType?: 'standard';
}

/**
 * Event-scoped request accepted by the score-submission endpoint. Narrow on
 * `scoreType` before reading queue, bracket-game, or match identifiers.
 */
export type ScoreSubmissionRequest =
  | SeedingScoreSubmissionRequest
  | BracketScoreSubmissionRequest
  | DoubleSeedingScoreSubmissionRequest;

/**
 * Parsed score-submission API record. Optional trailing fields are joined
 * display data supplied by event-scoped administrative list endpoints.
 */
export interface ScoreSubmissionRecord {
  id: number;
  user_id: number | null;
  template_id: number;
  participant_name: string | null;
  match_id: string | null;
  score_data: ScoreData;
  status: ScoreSubmissionStatus;
  reviewed_by: number | null;
  reviewed_at: string | null;
  event_id: number | null;
  score_type: ScoreType | null;
  game_queue_id: number | null;
  bracket_game_id: number | null;
  seeding_score_id: number | null;
  double_seeding_match_id: number | null;
  result_type: BracketResultType;
  disqualified_team_id: number | null;
  result_note: string | null;
  created_at: string;
  updated_at: string;
  template_name?: string;
  reviewer_name?: string | null;
  submitted_by?: string;
  team_display_number?: string;
  team_name?: string;
  bracket_name?: string;
  game_number?: number;
  queue_position?: number;
  seeding_round?: number;
  bracket_team1_id?: number | null;
  bracket_team2_id?: number | null;
  bracket_team1_score?: number | null;
  bracket_team2_score?: number | null;
  bracket_team1_number?: number | null;
  bracket_team1_name?: string | null;
  bracket_team1_display?: string | null;
  bracket_team2_number?: number | null;
  bracket_team2_name?: string | null;
  bracket_team2_display?: string | null;
  bracket_winner_number?: number | null;
  bracket_winner_name?: string | null;
  bracket_winner_display?: string | null;
  double_seeding_round?: number | null;
  double_seeding_match_number?: number | null;
  double_seeding_team1_id?: number | null;
  double_seeding_team2_id?: number | null;
  double_seeding_team1_number?: number | null;
  double_seeding_team1_name?: string | null;
  double_seeding_team1_display?: string | null;
  double_seeding_team2_number?: number | null;
  double_seeding_team2_name?: string | null;
  double_seeding_team2_display?: string | null;
}

/** Database-row form used before the JSON `score_data` column is parsed. */
export interface StoredScoreSubmissionRecord extends Omit<
  ScoreSubmissionRecord,
  'score_data'
> {
  score_data: string;
}

/** Result returned by dependency-free schema and field-template validators. */
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

function fieldPath(
  path: string,
  field: { id?: string; type?: string },
): string {
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
 *
 * @remarks Use at initialization/reset boundaries that may still receive an
 * untrusted field object. Typed consumers can read `defaultValue` after normal
 * field narrowing instead.
 */
export function getFieldDefaultValue(field: unknown): unknown {
  if (!isPlainObject(field)) return undefined;
  if (!('defaultValue' in field)) return undefined;
  return field.defaultValue;
}

/**
 * Initial blank / reset value for an interactive field.
 * Uses `defaultValue` when present; otherwise type-based empty defaults.
 *
 * @remarks Intended for form and preview initialization. Its `unknown` return
 * reflects the untrusted input boundary; callers should narrow it using the
 * corresponding field type.
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
        isPlainObject(child) && typeof child.id === 'string' ? child.id : index
      }]`;
      errors.push(...validateFieldNode(child, childPath));
    });
  }

  return errors;
}

/**
 * Validate defaultValue / startValue rules for a list of field definitions
 * (full schema fields or field-template arrays).
 *
 * @remarks Call from reusable field-template create/update routes and portable
 * export boundaries before persisting or serializing author-supplied fields.
 */
export function validateScoresheetFields(
  fields: unknown,
): SchemaValidationResult {
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
 *
 * @remarks Call from scoresheet-template create/update routes. This deliberately
 * remains a focused write-boundary validator rather than a general read decoder.
 */
export function validateScoresheetSchema(
  schema: unknown,
): SchemaValidationResult {
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

/** Formats validator errors for a single HTTP/API error response. */
export function formatSchemaValidationError(errors: string[]): string {
  if (errors.length === 1) {
    return errors[0];
  }
  return `Invalid scoresheet schema:\n${errors.map((e) => `  - ${e}`).join('\n')}`;
}
