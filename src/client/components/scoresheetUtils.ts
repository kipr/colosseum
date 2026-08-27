import { scoreBotballCubeStacks } from '../scoring/botballCubeStacks';
import { scoreBotballStartBoxCubes } from '../scoring/botballStartBoxCubes';
import {
  getBlankFieldValue,
  isPlainObject,
  isRepeatableGroupField,
  isScoresheetValue,
  SCORESHEET_SCHEMA_VERSION,
  type RepeatableGroupDerivedResult,
  type RepeatableGroupRows,
  type ScoresheetValue,
} from '../../shared/scoresheetDocument';
import type {
  DbBracketSource,
  RepeatableGroupField,
  ScoreFieldEntry,
  ScoresheetField,
  ScoresheetFieldType,
  ScoresheetSchema,
} from '../../shared/scoresheetSchema';

export type { DbBracketSource };

export interface BracketTeamDisplay {
  teamNumber: string;
  displayName: string;
}

export interface BracketGameOption {
  gameNumber: number;
  bracketGameId?: number;
  bracketId?: number;
  bracketName?: string | null;
  roundName?: string | null;
  bracketSide?: string | null;
  queuePosition?: number | null;
  team1: BracketTeamDisplay | null;
  team2: BracketTeamDisplay | null;
  hasWinner?: boolean;
}

type RepeatableGroupChild = RepeatableGroupField['fields'][number];

const REPEATABLE_GROUP_TEXT_TYPES = new Set<ScoresheetFieldType>([
  'text',
  'dropdown',
  'buttons',
]);

const DERIVED_OUTPUT_KEYS = [
  'sortedEquivalent',
  'unsortedEquivalent',
  'subtotal',
] as const;

type DerivedOutputKey = (typeof DERIVED_OUTPUT_KEYS)[number];

export function shouldHideSoloDoubleSeedingField(
  fieldId: string | undefined,
  formData: Record<string, unknown>,
  isDoubleSeeding: boolean,
): boolean {
  if (
    !isDoubleSeeding ||
    formData.double_seeding_match_id == null ||
    formData.team_b_id != null
  ) {
    return false;
  }

  return ['team_b_team_initials', 'side_b_team_initials'].includes(
    fieldId ?? '',
  );
}

function toScoresheetValue(value: unknown): ScoresheetValue {
  return isScoresheetValue(value) ? value : '';
}

function asRepeatableGroupRow(value: unknown): Record<string, ScoresheetValue> {
  if (!isPlainObject(value)) {
    return {};
  }

  const row: Record<string, ScoresheetValue> = {};
  for (const [key, cell] of Object.entries(value)) {
    if (isScoresheetValue(cell)) {
      row[key] = cell;
    }
  }
  return row;
}

function asDerivedRow(row: object): Record<string, ScoresheetValue> {
  const copied: Record<string, ScoresheetValue> = {};
  for (const [key, value] of Object.entries(row)) {
    if (isScoresheetValue(value)) {
      copied[key] = value;
    }
  }
  return copied;
}

function isBlankRepeatableGroupValue(
  value: unknown,
  field?: RepeatableGroupChild,
): boolean {
  if (field?.type === 'number') {
    return (
      value === '' ||
      value === null ||
      value === undefined ||
      Number(value) === 0
    );
  }

  if (field?.type === 'checkbox') {
    return value === false || value === null || value === undefined;
  }

  if (field && REPEATABLE_GROUP_TEXT_TYPES.has(field.type)) {
    return value === '' || value === null || value === undefined;
  }

  if (
    value === '' ||
    value === null ||
    value === undefined ||
    value === false
  ) {
    return true;
  }

  if (typeof value === 'number') {
    return value === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }

  return false;
}

function getRepeatableGroupChildField(
  field: RepeatableGroupField,
  childFieldId: string,
): RepeatableGroupChild | undefined {
  return field.fields.find((childField) => childField.id === childFieldId);
}

function isStartBoxCubeRowWithoutQuantity(
  row: Record<string, ScoresheetValue>,
  field: RepeatableGroupField,
): boolean {
  if (field.derived?.type !== 'botballStartBoxCubes') {
    return false;
  }

  const quantityField = getRepeatableGroupChildField(field, 'quantity');
  const quantityBlank = isBlankRepeatableGroupValue(
    row.quantity,
    quantityField,
  );

  if (!quantityBlank) {
    return false;
  }

  const configuredFieldIds = new Set(
    field.fields.map((childField) => childField.id),
  );

  return Object.entries(row).every(([key, value]) => {
    if (configuredFieldIds.has(key)) {
      return true;
    }

    return isBlankRepeatableGroupValue(value);
  });
}

function getRepeatableGroupMinRows(field: RepeatableGroupField): number {
  const minRows = field.minRows;
  return typeof minRows === 'number' && minRows > 0 ? Math.floor(minRows) : 1;
}

export function createBlankRepeatableGroupRow(
  field: RepeatableGroupField,
): Record<string, ScoresheetValue> {
  const row: Record<string, ScoresheetValue> = {};

  field.fields.forEach((childField) => {
    row[childField.id] = toScoresheetValue(getBlankFieldValue(childField));
  });

  return row;
}

export function isRepeatableGroupRowBlank(
  row: unknown,
  field: RepeatableGroupField,
): boolean {
  if (!isPlainObject(row)) {
    return true;
  }

  const typedRow = asRepeatableGroupRow(row);

  if (isStartBoxCubeRowWithoutQuantity(typedRow, field)) {
    return true;
  }

  const configuredFieldIds = new Set(
    field.fields.map((childField) => childField.id),
  );
  const configuredValuesBlank = field.fields.every((childField) => {
    return isBlankRepeatableGroupValue(typedRow[childField.id], childField);
  });

  if (!configuredValuesBlank) {
    return false;
  }

  return Object.entries(typedRow).every(([key, value]) => {
    if (configuredFieldIds.has(key)) {
      return true;
    }

    return isBlankRepeatableGroupValue(value);
  });
}

export function normalizeRepeatableGroupRows(
  value: unknown,
  field: RepeatableGroupField,
): RepeatableGroupRows {
  const minRows = getRepeatableGroupMinRows(field);
  const rows: RepeatableGroupRows = Array.isArray(value)
    ? value.map((row) => ({
        ...createBlankRepeatableGroupRow(field),
        ...asRepeatableGroupRow(row),
      }))
    : [];

  while (rows.length < minRows) {
    rows.push(createBlankRepeatableGroupRow(field));
  }

  return rows;
}

export function shouldAutoAppendRepeatableGroupRow(
  rows: RepeatableGroupRows,
  field: RepeatableGroupField,
): boolean {
  if (!Array.isArray(rows) || rows.length === 0) {
    return false;
  }

  return !isRepeatableGroupRowBlank(rows[rows.length - 1], field);
}

export function pruneRepeatableGroupRows(
  rows: RepeatableGroupRows,
  field: RepeatableGroupField,
): RepeatableGroupRows {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.filter((row) => !isRepeatableGroupRowBlank(row, field));
}

function repeatableGroupRowsEqual(
  left: RepeatableGroupRows,
  right: unknown,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function derivedResultFromCubeStacks(
  rows: RepeatableGroupRows,
  sortedValue: number,
  unsortedValue: number,
): RepeatableGroupDerivedResult {
  const result = scoreBotballCubeStacks(rows, {
    sortedValue,
    unsortedValue,
  });
  return {
    sortedEquivalent: result.sortedEquivalent,
    unsortedEquivalent: result.unsortedEquivalent,
    subtotal: result.subtotal,
    rows: result.rows.map((row) => asDerivedRow(row)),
  };
}

function derivedResultFromStartBoxCubes(
  rows: RepeatableGroupRows,
): RepeatableGroupDerivedResult {
  const result = scoreBotballStartBoxCubes(rows);
  return {
    subtotal: result.subtotal,
    rows: result.rows.map((row) => asDerivedRow(row)),
  };
}

export function calculateRepeatableGroupDerived(
  field: RepeatableGroupField,
  rows: RepeatableGroupRows,
): RepeatableGroupDerivedResult | undefined {
  if (field.derived?.type === 'botballCubeStacks') {
    return derivedResultFromCubeStacks(
      rows,
      field.derived.sortedValue,
      field.derived.unsortedValue,
    );
  }

  if (field.derived?.type === 'botballStartBoxCubes') {
    return derivedResultFromStartBoxCubes(rows);
  }

  return undefined;
}

export function calculateRepeatableGroupDerivedRows(
  field: RepeatableGroupField,
  rows: RepeatableGroupRows,
): Array<Record<string, ScoresheetValue> | undefined> {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map(
    (row) => calculateRepeatableGroupDerived(field, [row])?.rows[0],
  );
}

export function calculateRepeatableGroupDerivedValues(
  fields: ScoresheetField[],
  formData: Record<string, unknown>,
): {
  derivedByFieldId: Record<string, RepeatableGroupDerivedResult>;
  outputs: Record<string, number>;
} {
  const derivedByFieldId: Record<string, RepeatableGroupDerivedResult> = {};
  const outputs: Record<string, number> = {};

  fields.forEach((field) => {
    if (!isRepeatableGroupField(field) || !field.derived) {
      return;
    }

    const normalizedRows = normalizeRepeatableGroupRows(
      formData[field.id],
      field,
    );
    const rows = field.pruneBlankRows
      ? pruneRepeatableGroupRows(normalizedRows, field)
      : normalizedRows;
    const derived = calculateRepeatableGroupDerived(field, rows);
    if (!derived) {
      return;
    }

    derivedByFieldId[field.id] = derived;

    const configuredOutputs = field.derived.outputs;
    if (!configuredOutputs) {
      return;
    }

    DERIVED_OUTPUT_KEYS.forEach((outputKey) => {
      const outputFieldId = configuredOutputs[outputKey];
      if (outputFieldId) {
        outputs[outputFieldId] = Number(derived[outputKey]) || 0;
      }
    });
  });

  return { derivedByFieldId, outputs };
}

export function buildRepeatableGroupDerivedOutputScoreEntries(
  field: RepeatableGroupField,
  derived: RepeatableGroupDerivedResult | undefined,
  fields: ScoresheetField[] = [],
): Record<string, ScoreFieldEntry> {
  const entries: Record<string, ScoreFieldEntry> = {};
  const configuredOutputs = field.derived?.outputs;
  if (!configuredOutputs) {
    return entries;
  }

  const outputDefaults: Record<
    DerivedOutputKey,
    { label: string; type: ScoresheetFieldType }
  > = {
    sortedEquivalent: { label: 'Sorted Cubes', type: 'number' },
    unsortedEquivalent: { label: 'Unsorted Cubes', type: 'number' },
    subtotal: {
      label:
        field.derived?.type === 'botballStartBoxCubes'
          ? 'Cube Points'
          : 'Subtotal',
      type: 'calculated',
    },
  };

  DERIVED_OUTPUT_KEYS.forEach((outputKey) => {
    const outputFieldId = configuredOutputs[outputKey];
    if (!outputFieldId) {
      return;
    }

    const schemaField = fields.find(
      (candidate) => candidate.id === outputFieldId,
    );
    const defaults = outputDefaults[outputKey];
    entries[outputFieldId] = {
      label: schemaField?.label ?? defaults.label,
      type: schemaField?.type ?? defaults.type,
      value: Number(derived?.[outputKey]) || 0,
    };
  });

  return entries;
}

export function buildRepeatableGroupDerivedScoreEntries(
  fields: ScoresheetField[],
  derivedByFieldId: Record<string, RepeatableGroupDerivedResult>,
): Record<string, ScoreFieldEntry> {
  return fields.reduce<Record<string, ScoreFieldEntry>>((entries, field) => {
    if (!isRepeatableGroupField(field) || !derivedByFieldId[field.id]) {
      return entries;
    }

    return {
      ...entries,
      ...buildRepeatableGroupDerivedOutputScoreEntries(
        field,
        derivedByFieldId[field.id],
        fields,
      ),
    };
  }, {});
}

export function buildRepeatableGroupScoreEntry(
  field: RepeatableGroupField,
  existingEntry: ScoreFieldEntry | undefined,
  formValue: unknown,
  derived?: RepeatableGroupDerivedResult,
): ScoreFieldEntry {
  const normalizedRows = normalizeRepeatableGroupRows(formValue, field);
  const submittedRows = Array.isArray(existingEntry?.value)
    ? existingEntry.value
    : [];
  const prunedRows = field.pruneBlankRows
    ? pruneRepeatableGroupRows(normalizedRows, field)
    : normalizedRows;
  const rowsUnchanged =
    repeatableGroupRowsEqual(prunedRows, submittedRows) ||
    repeatableGroupRowsEqual(
      pruneRepeatableGroupRows(normalizedRows, field),
      submittedRows,
    );
  const value = rowsUnchanged ? submittedRows : prunedRows;
  const nextEntry: ScoreFieldEntry = {
    label: field.label ?? existingEntry?.label,
    value,
    type: field.type,
  };

  if (derived) {
    nextEntry.derived = derived;
  } else if (rowsUnchanged && existingEntry?.derived) {
    nextEntry.derived = existingEntry.derived;
  }

  return nextEntry;
}

export function getRepeatableGroupRowKeys(rows: unknown[]): string[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return Array.from(
    new Set(
      rows.flatMap((row) => (isPlainObject(row) ? Object.keys(row) : [])),
    ),
  );
}

export function buildEventScopedBracketSource(
  eventId: number | null,
): DbBracketSource {
  return {
    type: 'db',
    scope: 'event',
    eventId,
  };
}

export function getBracketSourceEventId(
  bracketSource: unknown,
  fallbackEventId?: number | null,
): number | null {
  if (!isPlainObject(bracketSource) || bracketSource.type !== 'db') {
    return fallbackEventId ?? null;
  }

  const rawEventId = bracketSource.eventId;
  const eventId = typeof rawEventId === 'number' ? rawEventId : null;

  if (bracketSource.scope === 'event') {
    return eventId ?? fallbackEventId ?? null;
  }

  return fallbackEventId ?? null;
}

export function isEventScopedBracketSource(
  bracketSource: unknown,
  fallbackEventId?: number | null,
): boolean {
  return getBracketSourceEventId(bracketSource, fallbackEventId) != null;
}

function adaptDoubleEliminationId(value: string): string {
  return value.replace(/side_a/g, 'team_a').replace(/side_b/g, 'team_b');
}

function adaptSectionHeaderLabel(label: string): string {
  if (label === 'SIDE A') return 'TEAM A';
  if (label === 'SIDE B') return 'TEAM B';
  return label;
}

function adaptDerivedOutputs(
  derived: RepeatableGroupField['derived'],
): RepeatableGroupField['derived'] {
  if (!derived?.outputs) {
    return derived;
  }

  const { outputs } = derived;
  return {
    ...derived,
    outputs: {
      ...(outputs.sortedEquivalent != null
        ? {
            sortedEquivalent: adaptDoubleEliminationId(
              outputs.sortedEquivalent,
            ),
          }
        : {}),
      ...(outputs.unsortedEquivalent != null
        ? {
            unsortedEquivalent: adaptDoubleEliminationId(
              outputs.unsortedEquivalent,
            ),
          }
        : {}),
      ...(outputs.subtotal != null
        ? { subtotal: adaptDoubleEliminationId(outputs.subtotal) }
        : {}),
    },
  };
}

export function adaptDoubleEliminationFields(
  templateFields: ScoresheetField[],
): ScoresheetField[] {
  return templateFields.map((field): ScoresheetField => {
    const id = adaptDoubleEliminationId(field.id);

    switch (field.type) {
      case 'calculated':
        return {
          ...field,
          id,
          formula: adaptDoubleEliminationId(field.formula),
        };
      case 'repeatableGroup':
        return {
          ...field,
          id,
          derived: adaptDerivedOutputs(field.derived),
        };
      case 'section_header':
        return {
          ...field,
          id,
          label: adaptSectionHeaderLabel(field.label),
        };
      default:
        return { ...field, id };
    }
  });
}

function doubleEliminationIdentityFields(): ScoresheetField[] {
  return [
    {
      id: 'game_number',
      label: 'Game',
      type: 'dropdown',
      required: true,
      dataSource: {
        type: 'bracket',
      },
      cascades: {
        team_a_number: 'team1.teamNumber',
        team_a_name: 'team1.displayName',
        team_b_number: 'team2.teamNumber',
        team_b_name: 'team2.displayName',
      },
    },
    {
      id: 'team_a_number',
      label: 'Team A Number',
      type: 'text',
      required: true,
      autoPopulated: true,
      placeholder: 'Select game first',
    },
    {
      id: 'team_a_name',
      label: 'Team A Name',
      type: 'text',
      required: true,
      autoPopulated: true,
      placeholder: 'Select game first',
    },
    {
      id: 'team_b_number',
      label: 'Team B Number',
      type: 'text',
      required: true,
      autoPopulated: true,
      placeholder: 'Select game first',
    },
    {
      id: 'team_b_name',
      label: 'Team B Name',
      type: 'text',
      required: true,
      autoPopulated: true,
      placeholder: 'Select game first',
    },
    {
      id: 'winner',
      label: 'Winner',
      type: 'winner-select',
      required: true,
      options: [
        { value: 'team_a', label: 'Team A Wins' },
        { value: 'team_b', label: 'Team B Wins' },
      ],
    },
  ];
}

function doubleSeedingIdentityFields(): ScoresheetField[] {
  return [
    {
      id: 'team_a_number',
      label: 'Team A Number',
      type: 'text',
      required: true,
      autoPopulated: true,
      placeholder: 'Select match first',
    },
    {
      id: 'team_a_name',
      label: 'Team A Name',
      type: 'text',
      required: true,
      autoPopulated: true,
      placeholder: 'Select match first',
    },
    {
      id: 'team_b_number',
      label: 'Team B Number',
      type: 'text',
      required: false,
      autoPopulated: true,
      placeholder: 'Select match first',
    },
    {
      id: 'team_b_name',
      label: 'Team B Name',
      type: 'text',
      required: false,
      autoPopulated: true,
      placeholder: 'Select match first',
    },
  ];
}

function defaultTeamScoreFields(): ScoresheetField[] {
  return [
    {
      id: 'section_header_team_a',
      label: 'TEAM A',
      type: 'section_header',
      column: 'left',
    },
    {
      id: 'team_a_score',
      label: 'Team A Score',
      type: 'number',
      column: 'left',
      required: false,
      min: 0,
      step: 1,
    },
    {
      id: 'team_a_total',
      label: 'TEAM A TOTAL',
      type: 'calculated',
      column: 'left',
      isTotal: true,
      formula: 'team_a_score',
    },
    {
      id: 'section_header_team_b',
      label: 'TEAM B',
      type: 'section_header',
      column: 'right',
    },
    {
      id: 'team_b_score',
      label: 'Team B Score',
      type: 'number',
      column: 'right',
      required: false,
      min: 0,
      step: 1,
    },
    {
      id: 'team_b_total',
      label: 'TEAM B TOTAL',
      type: 'calculated',
      column: 'right',
      isTotal: true,
      formula: 'team_b_score',
    },
  ];
}

export function buildDoubleEliminationSchema(options: {
  title: string;
  eventId: number | null;
  templateFields?: ScoresheetField[] | null;
}): ScoresheetSchema {
  const { title, eventId, templateFields } = options;
  const scoringFields =
    templateFields && templateFields.length > 0
      ? adaptDoubleEliminationFields(templateFields)
      : defaultTeamScoreFields();

  return {
    schemaVersion: SCORESHEET_SCHEMA_VERSION,
    layout: 'two-column',
    mode: 'head-to-head',
    title: title || 'Double Elimination Score Sheet',
    eventId,
    scoreDestination: 'db',
    bracketSource: buildEventScopedBracketSource(eventId),
    teamsDataSource: {
      type: 'db',
      eventId,
      teamNumberField: 'team_number',
      teamNameField: 'team_name',
    },
    fields: [...doubleEliminationIdentityFields(), ...scoringFields],
  } satisfies ScoresheetSchema;
}

/**
 * Build a double-seeding scoresheet schema. Two teams share one match and
 * scoresheet, but each team only receives its own side total — so there is no
 * winner selection and no combined grand total. The match is selected from the
 * double-seeding queue (handled by ScoresheetForm via `scoreKind`).
 */
export function buildDoubleSeedingSchema(options: {
  title: string;
  eventId: number | null;
  templateFields?: ScoresheetField[] | null;
}): ScoresheetSchema {
  const { title, eventId, templateFields } = options;
  const scoringFields =
    templateFields && templateFields.length > 0
      ? adaptDoubleEliminationFields(templateFields)
      : defaultTeamScoreFields();

  return {
    schemaVersion: SCORESHEET_SCHEMA_VERSION,
    layout: 'two-column',
    scoreKind: 'double_seeding',
    title: title || 'Double Seeding Score Sheet',
    eventId,
    scoreDestination: 'db',
    teamsDataSource: {
      type: 'db',
      eventId,
      teamNumberField: 'team_number',
      teamNameField: 'team_name',
    },
    fields: [...doubleSeedingIdentityFields(), ...scoringFields],
  } satisfies ScoresheetSchema;
}

export function formatBracketGameOptionLabel(game: BracketGameOption): string {
  const team1Display = game.team1?.displayName || 'TBD';
  const team2Display = game.team2?.displayName || 'TBD';
  return `${team1Display} vs ${team2Display}`;
}

export function getBracketGameOptionValue(
  game: BracketGameOption,
  eventScoped: boolean,
): string {
  if (eventScoped) {
    return game.bracketGameId != null ? String(game.bracketGameId) : '';
  }

  return String(game.gameNumber);
}

export function findBracketGameBySelection(
  games: BracketGameOption[],
  selectedValue: string,
  eventScoped: boolean,
): BracketGameOption | undefined {
  const numericValue = Number(selectedValue);
  if (!selectedValue || Number.isNaN(numericValue)) {
    return undefined;
  }

  if (eventScoped) {
    return games.find((game) => game.bracketGameId === numericValue);
  }

  return games.find((game) => game.gameNumber === numericValue);
}
