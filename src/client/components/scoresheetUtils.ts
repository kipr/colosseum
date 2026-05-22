/* eslint-disable @typescript-eslint/no-explicit-any */
import { scoreBotballCubeStacks } from '../scoring/botballCubeStacks';

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

function getRepeatableGroupMinRows(field: any): number {
  const minRows = Number(field?.minRows);
  return Number.isFinite(minRows) && minRows > 0 ? Math.floor(minRows) : 1;
}

function getBlankRepeatableGroupValue(field: any): any {
  if (field.defaultValue !== undefined) {
    return field.defaultValue;
  }

  if (field.startValue !== undefined) {
    return field.startValue;
  }

  if (field.type === 'checkbox') {
    return false;
  }

  return '';
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
  if (field?.derived?.type !== 'botballCubeStacks') {
    return undefined;
  }

  return scoreBotballCubeStacks(rows, {
    sortedValue: field.derived.sortedValue,
    unsortedValue: field.derived.unsortedValue,
  });
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
    subtotal: { label: 'Subtotal', type: 'calculated' },
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

export function adaptDoubleEliminationFields(templateFields: any[]): any[] {
  return templateFields.map((field) => {
    const newField = { ...field };

    if (newField.id) {
      newField.id = newField.id
        .replace(/side_a/g, 'team_a')
        .replace(/side_b/g, 'team_b');
    }

    if (newField.formula) {
      newField.formula = newField.formula
        .replace(/side_a/g, 'team_a')
        .replace(/side_b/g, 'team_b');
    }

    if (newField.type === 'section_header') {
      if (newField.label === 'SIDE A') newField.label = 'TEAM A';
      if (newField.label === 'SIDE B') newField.label = 'TEAM B';
    }

    return newField;
  });
}

export function buildDoubleEliminationSchema(options: {
  title: string;
  eventId: number | null;
  templateFields?: any[] | null;
}): any {
  const { title, eventId, templateFields } = options;
  const schema: any = {
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
    fields: [],
  };

  schema.fields.push({
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
  });

  schema.fields.push({
    id: 'team_a_number',
    label: 'Team A Number',
    type: 'text',
    required: true,
    autoPopulated: true,
    placeholder: 'Select game first',
  });

  schema.fields.push({
    id: 'team_a_name',
    label: 'Team A Name',
    type: 'text',
    required: true,
    autoPopulated: true,
    placeholder: 'Select game first',
  });

  schema.fields.push({
    id: 'team_b_number',
    label: 'Team B Number',
    type: 'text',
    required: true,
    autoPopulated: true,
    placeholder: 'Select game first',
  });

  schema.fields.push({
    id: 'team_b_name',
    label: 'Team B Name',
    type: 'text',
    required: true,
    autoPopulated: true,
    placeholder: 'Select game first',
  });

  schema.fields.push({
    id: 'winner',
    label: 'Winner',
    type: 'winner-select',
    required: true,
    options: [
      { value: 'team_a', label: 'Team A Wins' },
      { value: 'team_b', label: 'Team B Wins' },
    ],
  });

  if (templateFields && templateFields.length > 0) {
    schema.fields.push(...adaptDoubleEliminationFields(templateFields));
    return schema;
  }

  schema.fields.push({
    id: 'section_header_team_a',
    label: 'TEAM A',
    type: 'section_header',
    column: 'left',
  });

  schema.fields.push({
    id: 'team_a_score',
    label: 'Team A Score',
    type: 'number',
    column: 'left',
    required: false,
    min: 0,
    step: 1,
  });

  schema.fields.push({
    id: 'team_a_total',
    label: 'TEAM A TOTAL',
    type: 'calculated',
    column: 'left',
    isTotal: true,
    formula: 'team_a_score',
  });

  schema.fields.push({
    id: 'section_header_team_b',
    label: 'TEAM B',
    type: 'section_header',
    column: 'right',
  });

  schema.fields.push({
    id: 'team_b_score',
    label: 'Team B Score',
    type: 'number',
    column: 'right',
    required: false,
    min: 0,
    step: 1,
  });

  schema.fields.push({
    id: 'team_b_total',
    label: 'TEAM B TOTAL',
    type: 'calculated',
    column: 'right',
    isTotal: true,
    formula: 'team_b_score',
  });

  return schema;
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
