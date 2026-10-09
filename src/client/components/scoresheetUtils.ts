/* eslint-disable @typescript-eslint/no-explicit-any */
import { scoreBotballCubeStacks } from '../scoring/botballCubeStacks';
import { scoreBotballStartBoxCubes } from '../scoring/botballStartBoxCubes';
import {
  getBlankFieldValue,
  getFieldDefaultValue,
} from '../../shared/scoresheetSchema';
import { stripLegacyInitialsFields } from '../../shared/teamInitials';

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

export interface DbBracketSource {
  type: 'db';
  scope?: 'event';
  eventId?: number | null;
  bracketId?: number | null;
}

const REPEATABLE_GROUP_TEXT_TYPES = new Set(['text', 'dropdown', 'buttons']);

function isBlankRepeatableGroupValue(value: any, field?: any): boolean {
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

function getRepeatableGroupChildField(field: any, childFieldId: string): any {
  return (field?.fields || []).find(
    (childField: any) => childField?.id === childFieldId,
  );
}

function isStartBoxCubeRowWithoutQuantity(row: any, field: any): boolean {
  if (field?.derived?.type !== 'botballStartBoxCubes') {
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
    (field?.fields || [])
      .map((childField: any) => childField?.id)
      .filter((id: any) => id != null),
  );

  return Object.entries(row).every(([key, value]) => {
    if (configuredFieldIds.has(key)) {
      return true;
    }

    return isBlankRepeatableGroupValue(value);
  });
}

function getRepeatableGroupMinRows(field: any): number {
  const minRows = Number(field?.minRows);
  return Number.isFinite(minRows) && minRows > 0 ? Math.floor(minRows) : 1;
}

function getBlankRepeatableGroupValue(field: any): any {
  return getBlankFieldValue(field);
}

export function createBlankRepeatableGroupRow(field: any): Record<string, any> {
  const row: Record<string, any> = {};

  (field?.fields || []).forEach((childField: any) => {
    if (!childField?.id) return;
    row[childField.id] = getBlankRepeatableGroupValue(childField);
  });

  return row;
}

export function isRepeatableGroupRowBlank(row: any, field: any): boolean {
  if (!row || typeof row !== 'object') {
    return true;
  }

  if (isStartBoxCubeRowWithoutQuantity(row, field)) {
    return true;
  }

  const childFields = field?.fields || [];
  const configuredFieldIds = new Set(
    childFields
      .map((childField: any) => childField?.id)
      .filter((id: any) => id != null),
  );
  const configuredValuesBlank = childFields.every((childField: any) => {
    const value = row[childField.id];

    return isBlankRepeatableGroupValue(value, childField);
  });

  if (!configuredValuesBlank) {
    return false;
  }

  return Object.entries(row).every(([key, value]) => {
    if (configuredFieldIds.has(key)) {
      return true;
    }

    return isBlankRepeatableGroupValue(value);
  });
}

export function normalizeRepeatableGroupRows(
  value: any,
  field: any,
): Array<Record<string, any>> {
  const minRows = getRepeatableGroupMinRows(field);
  const rows = Array.isArray(value)
    ? value.map((row) => ({
        ...createBlankRepeatableGroupRow(field),
        ...(row && typeof row === 'object' ? row : {}),
      }))
    : [];

  while (rows.length < minRows) {
    rows.push(createBlankRepeatableGroupRow(field));
  }

  return rows;
}

export function shouldAutoAppendRepeatableGroupRow(
  rows: any[],
  field: any,
): boolean {
  if (!Array.isArray(rows) || rows.length === 0) {
    return false;
  }

  return !isRepeatableGroupRowBlank(rows[rows.length - 1], field);
}

export function pruneRepeatableGroupRows(
  rows: any[],
  field: any,
): Array<Record<string, any>> {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.filter((row) => !isRepeatableGroupRowBlank(row, field));
}

function repeatableGroupRowsEqual(left: any, right: any): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function calculateRepeatableGroupDerived(field: any, rows: any[]): any {
  if (field?.derived?.type === 'botballCubeStacks') {
    return scoreBotballCubeStacks(rows, {
      sortedValue: field.derived.sortedValue,
      unsortedValue: field.derived.unsortedValue,
    });
  }

  if (field?.derived?.type === 'botballStartBoxCubes') {
    return scoreBotballStartBoxCubes(rows);
  }

  return undefined;
}

export function calculateRepeatableGroupDerivedRows(
  field: any,
  rows: any[],
): any[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows.map(
    (row) => calculateRepeatableGroupDerived(field, [row])?.rows[0],
  );
}

export function calculateRepeatableGroupDerivedValues(
  fields: any[],
  formData: Record<string, any>,
): {
  derivedByFieldId: Record<string, any>;
  outputs: Record<string, number>;
} {
  const derivedByFieldId: Record<string, any> = {};
  const outputs: Record<string, number> = {};

  fields.forEach((field) => {
    if (field?.type !== 'repeatableGroup' || !field.derived) {
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

    const configuredOutputs = field.derived.outputs || {};
    ['sortedEquivalent', 'unsortedEquivalent', 'subtotal'].forEach(
      (outputKey) => {
        const outputFieldId = configuredOutputs[outputKey];
        if (outputFieldId) {
          outputs[outputFieldId] = Number(derived[outputKey]) || 0;
        }
      },
    );
  });

  return { derivedByFieldId, outputs };
}

function evaluateFormula(
  formula: string,
  data: Record<string, any>,
  calculated: Record<string, number>,
): number {
  let expression = formula;
  const fieldIds = formula.match(/[a-z_][a-z0-9_]*/gi) || [];
  const uniqueFieldIds = Array.from(new Set(fieldIds));

  uniqueFieldIds.forEach((fieldId) => {
    let value: any = 0;

    if (calculated[fieldId] !== undefined) {
      value = calculated[fieldId];
    } else if (data[fieldId] !== undefined && data[fieldId] !== '') {
      value = data[fieldId];
    }

    let replacement: string;

    if (formula.includes(`${fieldId} ===`)) {
      replacement = `'${String(value)}'`;
    } else if (typeof value === 'string') {
      replacement = String(Number(value) || 0);
    } else if (typeof value === 'boolean') {
      replacement = value ? '1' : '0';
    } else {
      replacement = String(Number(value) || 0);
    }

    const regex = new RegExp(`\\b${fieldId}\\b`, 'g');
    expression = expression.replace(regex, replacement);
  });

  try {
    const result = eval(expression);
    return Number(result) || 0;
  } catch {
    return 0;
  }
}

// Evaluates every calculated field in schema order, so a formula can use
// calculated fields declared before it and repeatable-group derived outputs.
// Also returns the derived group values so callers saving a score sheet do
// not have to compute them again.
export function calculateFormulaValues(
  fields: any[] | undefined,
  data: Record<string, any>,
): {
  calculated: Record<string, number>;
  derivedByFieldId: Record<string, any>;
} {
  if (!Array.isArray(fields)) {
    return { calculated: {}, derivedByFieldId: {} };
  }

  const calculated: Record<string, number> = {};
  const { derivedByFieldId, outputs } = calculateRepeatableGroupDerivedValues(
    fields,
    data,
  );
  const formulaData = { ...data, ...outputs };

  fields.forEach((field: any) => {
    // Hand-edited or imported JSON can carry a non-string formula.
    if (
      field.type === 'calculated' &&
      typeof field.formula === 'string' &&
      field.formula
    ) {
      calculated[field.id] = evaluateFormula(
        field.formula,
        formulaData,
        calculated,
      );
    }
  });

  return { calculated, derivedByFieldId };
}

export function buildRepeatableGroupDerivedOutputScoreEntries(
  field: any,
  derived: any,
  fields: any[] = [],
): Record<string, any> {
  const entries: Record<string, any> = {};
  const configuredOutputs = field?.derived?.outputs || {};
  const outputDefaults: Record<string, { label: string; type: string }> = {
    sortedEquivalent: { label: 'Sorted Cubes', type: 'number' },
    unsortedEquivalent: { label: 'Unsorted Cubes', type: 'number' },
    subtotal: {
      label:
        field?.derived?.type === 'botballStartBoxCubes'
          ? 'Cube Points'
          : 'Subtotal',
      type: 'calculated',
    },
  };

  Object.entries(outputDefaults).forEach(([outputKey, defaults]) => {
    const outputFieldId = configuredOutputs[outputKey];
    if (!outputFieldId) {
      return;
    }

    const schemaField = fields.find(
      (candidate) => candidate.id === outputFieldId,
    );
    entries[outputFieldId] = {
      label: schemaField?.label ?? defaults.label,
      type: schemaField?.type ?? defaults.type,
      value: Number(derived?.[outputKey]) || 0,
    };
  });

  return entries;
}

export function buildRepeatableGroupDerivedScoreEntries(
  fields: any[],
  derivedByFieldId: Record<string, any>,
): Record<string, any> {
  return fields.reduce(
    (entries, field) => {
      if (field?.type !== 'repeatableGroup' || !derivedByFieldId[field.id]) {
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
    },
    {} as Record<string, any>,
  );
}

export function buildRepeatableGroupScoreEntry(
  field: any,
  existingEntry: any,
  formValue: any,
  derived?: any,
): Record<string, any> {
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
  const nextEntry: Record<string, any> = {
    ...existingEntry,
    label: field.label ?? existingEntry?.label,
    value,
    type: field.type,
  };

  if (!rowsUnchanged) {
    delete nextEntry.derived;
  }

  if (derived) {
    nextEntry.derived = derived;
  }

  return nextEntry;
}

export function getRepeatableGroupRowKeys(rows: any[]): string[] {
  if (!Array.isArray(rows)) {
    return [];
  }

  return Array.from(
    new Set(
      rows.flatMap((row: any) =>
        row && typeof row === 'object' && !Array.isArray(row)
          ? Object.keys(row)
          : [],
      ),
    ),
  );
}

function isZeroOrBlank(value: unknown): boolean {
  return (
    value === '' ||
    value === undefined ||
    value === null ||
    value === 0 ||
    value === '0'
  );
}

// An untouched number field whose value and default are both zero or blank
// shows an empty input with a placeholder instead of a literal 0.
export function shouldShowNumberPlaceholder(
  field: any,
  value: any,
  touched: boolean,
): boolean {
  return (
    !touched &&
    isZeroOrBlank(value) &&
    isZeroOrBlank(getFieldDefaultValue(field))
  );
}

export function getDisplayedNumberValue(
  field: any,
  value: any,
  touched: boolean,
): any {
  if (shouldShowNumberPlaceholder(field, value, touched)) {
    return '';
  }

  return value ?? '';
}

export function getNumberPlaceholder(
  field: any,
  value: any,
  touched: boolean,
): string {
  if (!shouldShowNumberPlaceholder(field, value, touched)) {
    return field.placeholder || '';
  }

  const startingValue = getFieldDefaultValue(field);
  if (
    startingValue !== undefined &&
    startingValue !== null &&
    String(startingValue) !== ''
  ) {
    return String(startingValue);
  }

  return field.placeholder || '0';
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
  if (!bracketSource || typeof bracketSource !== 'object') {
    return fallbackEventId ?? null;
  }

  const source = bracketSource as DbBracketSource;
  if (source.type !== 'db') {
    return fallbackEventId ?? null;
  }

  if (source.scope === 'event') {
    return source.eventId ?? fallbackEventId ?? null;
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

export function adaptDoubleEliminationFields(templateFields: any[]): any[] {
  return templateFields.map((field) => {
    const newField = { ...field };

    if (newField.id) {
      newField.id = adaptDoubleEliminationId(newField.id);
    }

    if (newField.formula) {
      newField.formula = adaptDoubleEliminationId(newField.formula);
    }

    if (newField.derived?.outputs) {
      newField.derived = {
        ...newField.derived,
        outputs: Object.fromEntries(
          Object.entries(newField.derived.outputs).map(([key, value]) => [
            key,
            typeof value === 'string' ? adaptDoubleEliminationId(value) : value,
          ]),
        ),
      };
    }

    if (newField.type === 'section_header') {
      if (newField.label === 'SIDE A') newField.label = 'TEAM A';
      if (newField.label === 'SIDE B') newField.label = 'TEAM B';
    }

    return newField;
  });
}

type TwoTeamSchemaOptions = {
  title: string;
  eventId: number | null;
  templateFields?: any[] | null;
  requireTeamInitials?: boolean;
};

function buildTeamsDataSource(eventId: number | null) {
  return {
    type: 'db',
    eventId,
    teamNumberField: 'team_number',
    teamNameField: 'team_name',
  };
}

function buildTeamIdentityFields(options: {
  placeholder: string;
  teamBRequired: boolean;
}): any[] {
  const { placeholder, teamBRequired } = options;
  return [
    { id: 'team_a_number', label: 'Team A Number', required: true },
    { id: 'team_a_name', label: 'Team A Name', required: true },
    { id: 'team_b_number', label: 'Team B Number', required: teamBRequired },
    { id: 'team_b_name', label: 'Team B Name', required: teamBRequired },
  ].map(({ id, label, required }) => ({
    id,
    label,
    type: 'text',
    required,
    autoPopulated: true,
    placeholder,
  }));
}

function buildFallbackSideFields(
  side: 'a' | 'b',
  column: 'left' | 'right',
): any[] {
  const letter = side.toUpperCase();
  return [
    {
      id: `section_header_team_${side}`,
      label: `TEAM ${letter}`,
      type: 'section_header',
      column,
    },
    {
      id: `team_${side}_score`,
      label: `Team ${letter} Score`,
      type: 'number',
      column,
      required: false,
      min: 0,
      step: 1,
    },
    {
      id: `team_${side}_total`,
      label: `TEAM ${letter} TOTAL`,
      type: 'calculated',
      column,
      isTotal: true,
      formula: `team_${side}_score`,
    },
  ];
}

// Template fields adapted from side A/B to team A/B, or a minimal per-team
// score section when the template has none. Side totals stay separate.
function buildTwoTeamScoringFields(templateFields?: any[] | null): any[] {
  // Initials are collected by the built-in panel, not template fields.
  const fields = templateFields
    ? stripLegacyInitialsFields(templateFields)
    : null;
  if (fields && fields.length > 0) {
    return adaptDoubleEliminationFields(fields);
  }

  return [
    ...buildFallbackSideFields('a', 'left'),
    ...buildFallbackSideFields('b', 'right'),
  ];
}

export function buildDoubleEliminationSchema(
  options: TwoTeamSchemaOptions,
): any {
  const { title, eventId, requireTeamInitials = true } = options;
  return {
    layout: 'two-column',
    mode: 'head-to-head',
    title: title || 'Double Elimination Score Sheet',
    eventId,
    scoreDestination: 'db',
    teamInitials: { required: requireTeamInitials },
    bracketSource: buildEventScopedBracketSource(eventId),
    teamsDataSource: buildTeamsDataSource(eventId),
    fields: [
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
      ...buildTeamIdentityFields({
        placeholder: 'Select game first',
        teamBRequired: true,
      }),
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
      ...buildTwoTeamScoringFields(options.templateFields),
    ],
  };
}

/**
 * Build a double-seeding scoresheet schema. Two teams share one match and
 * scoresheet, but each team only receives its own side total — so there is no
 * winner selection and no combined grand total. The match is selected from the
 * double-seeding queue (handled by ScoresheetForm via `scoreKind`).
 */
export function buildDoubleSeedingSchema(options: TwoTeamSchemaOptions): any {
  const { title, eventId, requireTeamInitials = true } = options;
  return {
    layout: 'two-column',
    scoreKind: 'double_seeding',
    title: title || 'Double Seeding Score Sheet',
    eventId,
    scoreDestination: 'db',
    teamInitials: { required: requireTeamInitials },
    teamsDataSource: buildTeamsDataSource(eventId),
    fields: [
      ...buildTeamIdentityFields({
        placeholder: 'Select match first',
        teamBRequired: false,
      }),
      // Reuses the side A/B field adaptation from DE.
      ...buildTwoTeamScoringFields(options.templateFields),
    ],
  };
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
