import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import {
  discriminateShape,
  formatSchemaValidationError,
  getBlankFieldValue,
  getFieldDefaultValue,
  parseScoresheetFields,
  parseScoresheetSchema,
  SCORESHEET_SCHEMA_VERSION,
  validateScoresheetFields,
  validateScoresheetSchema,
  type ScoresheetField,
  type ScoresheetSchema,
} from '../../src/shared/scoresheetSchema';
import { canonicalSchema } from '../helpers/canonicalSchema';

const TEMPLATES_DIR = path.join(__dirname, '../../templates');

function templateFiles(): string[] {
  return fs
    .readdirSync(TEMPLATES_DIR)
    .filter((name) => name.endsWith('.json'))
    .sort();
}

function readTemplate(name: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, name), 'utf8'));
}

function validNumberField(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'score',
    label: 'Score',
    type: 'number',
    min: 0,
    max: 10,
    step: 1,
    ...overrides,
  };
}

describe('discriminateShape', () => {
  it('classifies the three document shapes and unknowns', () => {
    expect(discriminateShape([])).toBe('bare_field_array');
    expect(discriminateShape({ fields: [] })).toBe('schema_object');
    expect(discriminateShape({ name: 'w', schema: { fields: [] } })).toBe(
      'wrapper',
    );
    expect(discriminateShape({ mode: 'head-to-head' })).toBe('unknown');
    expect(discriminateShape(null)).toBe('unknown');
    expect(discriminateShape('nope')).toBe('unknown');
  });
});

describe('checked-in templates parse', () => {
  it('parses every checked-in template in its document shape', () => {
    const files = templateFiles();
    expect(files).toHaveLength(9);

    for (const name of files) {
      const parsed = readTemplate(name);
      const shape = discriminateShape(parsed);
      if (shape === 'bare_field_array') {
        const result = parseScoresheetFields(parsed);
        expect(result.success, name).toBe(true);
      } else {
        const result = parseScoresheetSchema(parsed);
        expect(result.success, `${name}: ${JSON.stringify(result.success ? [] : result.error.issues)}`).toBe(
          true,
        );
      }
    }
  });
});

describe('validateScoresheetSchema compatibility wrapper', () => {
  it('rejects non-object schemas and missing version or fields', () => {
    expect(validateScoresheetSchema(null)).toEqual({
      ok: false,
      errors: ['schema must be an object.'],
    });
    expect(validateScoresheetSchema({ mode: 'head-to-head' }).ok).toBe(false);
    expect(validateScoresheetSchema({ fields: [] }).ok).toBe(false);
    expect(validateScoresheetSchema({ fields: 'x' }).ok).toBe(false);
    expect(validateScoresheetFields('nope')).toEqual({
      ok: false,
      errors: ['fields must be an array.'],
    });
  });

  it('accepts a minimal canonical schema and unwraps wrappers', () => {
    expect(validateScoresheetSchema(canonicalSchema())).toEqual({
      ok: true,
      errors: [],
    });
    expect(
      validateScoresheetSchema({
        name: 'Wrapped',
        description: '',
        schema: canonicalSchema({ title: 'Inner' }),
      }).ok,
    ).toBe(true);
  });
});

describe('field variants', () => {
  it('accepts valid typed defaults for interactive fields', () => {
    const result = validateScoresheetSchema(
      canonicalSchema({
        fields: [
          { id: 'name', label: 'Name', type: 'text', defaultValue: 'Ada' },
          {
            id: 'score',
            label: 'Score',
            type: 'number',
            min: 0,
            max: 10,
            defaultValue: 7,
          },
          {
            id: 'division',
            label: 'Division',
            type: 'dropdown',
            options: [
              { label: 'Junior', value: 'junior' },
              { label: 'Senior', value: 'senior' },
            ],
            defaultValue: 'senior',
          },
          {
            id: 'rating',
            label: 'Rating',
            type: 'buttons',
            options: [
              { label: 'Good', value: '4' },
              { label: 'Fair', value: '3' },
            ],
            defaultValue: '4',
          },
          { id: 'dq', label: 'DQ', type: 'checkbox', defaultValue: true },
          {
            id: 'team',
            label: 'Team',
            type: 'dropdown',
            dataSource: { type: 'db', eventId: 1 },
            defaultValue: 42,
          },
          {
            id: 'stacks',
            label: 'Stacks',
            type: 'repeatableGroup',
            fields: [
              { id: 'count', label: 'Count', type: 'number', min: 0, max: 5 },
              { id: 'notes', label: 'Notes', type: 'text' },
            ],
            defaultValue: [{ count: 2, notes: 'ok' }],
          },
        ],
      }),
    );

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('accepts headers, calculated, winner-select, and source variants', () => {
    const result = parseScoresheetSchema(
      canonicalSchema({
        layout: 'two-column',
        mode: 'head-to-head',
        bracketSource: { type: 'db', scope: 'event', eventId: 3, bracketId: 9 },
        teamsDataSource: {
          type: 'db',
          eventId: 3,
          teamNumberField: 'team_number',
          teamNameField: 'team_name',
        },
        fields: [
          { id: 'side_a', label: 'SIDE A', type: 'section_header', column: 'left' },
          { id: 'group', label: 'Group', type: 'group_header' },
          {
            id: 'total',
            label: 'Total',
            type: 'calculated',
            formula: 'a + b',
            isGrandTotal: true,
          },
          {
            id: 'winner',
            label: 'Winner',
            type: 'winner-select',
            options: [
              { value: 'team_a', label: 'Team A Wins' },
              { value: 'team_b', label: 'Team B Wins' },
            ],
          },
          {
            id: 'game',
            label: 'Game',
            type: 'dropdown',
            dataSource: { type: 'bracket', sheetName: 'DE 16 Team' },
            cascades: {
              team_a_number: 'team1.teamNumber',
              team_a_name: 'team1.displayName',
            },
          },
          {
            id: 'sheets_team',
            label: 'Sheets Team',
            type: 'dropdown',
            dataSource: {
              sheetName: 'Teams',
              range: 'A1:B',
              labelField: 'Team Number',
              valueField: 'Team Number',
            },
            cascades: { targetField: 'team_name', sourceField: 'Team Name' },
          },
        ],
      }),
    );
    expect(result.success).toBe(true);
  });

  it('accepts derived repeatable groups', () => {
    const result = parseScoresheetFields([
      {
        id: 'stacks',
        label: 'Stacks',
        type: 'repeatableGroup',
        minRows: 1,
        autoAppendBlankRow: true,
        pruneBlankRows: true,
        rowLabel: 'Stack',
        fields: [
          { id: 'has_pallet', label: 'Pallet', type: 'checkbox' },
          { id: 'small_red', label: 'Small Red', type: 'number', min: 0, step: 1 },
        ],
        derived: {
          type: 'botballCubeStacks',
          sortedValue: 30,
          unsortedValue: 10,
          outputs: { subtotal: 'subtotal' },
        },
      },
      {
        id: 'subtotal',
        label: 'Subtotal',
        type: 'calculated',
        formula: 'stacks',
        isTotal: true,
      },
    ]);
    expect(result.success).toBe(true);
  });
});

describe('refinements', () => {
  it('rejects startValue as an unsupported field key', () => {
    const result = validateScoresheetFields([
      { id: 'legacy', label: 'Legacy', type: 'text', startValue: 'old' },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('startValue'))).toBe(true);
  });

  it('rejects defaultValue type mismatches', () => {
    const result = validateScoresheetFields([
      { id: 'name', label: 'Name', type: 'text', defaultValue: 1 },
      { id: 'score', label: 'Score', type: 'number', defaultValue: '5' },
      {
        id: 'score_nan',
        label: 'NaN',
        type: 'number',
        defaultValue: Number.NaN,
      },
      { id: 'flag', label: 'Flag', type: 'checkbox', defaultValue: 'yes' },
      { id: 'missing_type', label: 'Missing', defaultValue: 'x' },
    ]);
    expect(result.ok).toBe(false);
  });

  it('rejects option defaults that are not in the declared list', () => {
    const result = validateScoresheetFields([
      {
        id: 'division',
        label: 'Division',
        type: 'dropdown',
        options: [{ label: 'Junior', value: 'junior' }],
        defaultValue: 'senior',
      },
      {
        id: 'rating',
        label: 'Rating',
        type: 'buttons',
        options: [{ label: 'Good', value: '4' }],
        defaultValue: '9',
      },
    ]);
    expect(result.ok).toBe(false);
    expect(
      result.errors.some((e) => e.includes('match one of the declared options')),
    ).toBe(true);
  });

  it('rejects numeric defaults outside min and max', () => {
    const result = validateScoresheetFields([
      {
        id: 'score_low',
        label: 'Low',
        type: 'number',
        min: 1,
        defaultValue: 0,
      },
      {
        id: 'score_high',
        label: 'High',
        type: 'number',
        max: 5,
        defaultValue: 9,
      },
    ]);
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('below min'))).toBe(true);
    expect(result.errors.some((e) => e.includes('above max'))).toBe(true);
  });

  it('rejects defaults on calculated, header, and winner-select fields', () => {
    const result = validateScoresheetFields([
      {
        id: 'total',
        label: 'Total',
        type: 'calculated',
        formula: 'a+b',
        defaultValue: 0,
      },
      {
        id: 'section',
        type: 'section_header',
        label: 'A',
        defaultValue: 'x',
      },
      { id: 'group', type: 'group_header', label: 'B', defaultValue: 'y' },
      { id: 'winner', label: 'Winner', type: 'winner-select', defaultValue: 'a' },
    ]);

    expect(result.ok).toBe(false);
    expect(
      result.errors.filter((error) => error.includes('does not support defaultValue')),
    ).toHaveLength(4);
  });

  it('validates repeatableGroup default rows recursively', () => {
    const result = validateScoresheetFields([
      {
        id: 'stacks',
        label: 'Stacks',
        type: 'repeatableGroup',
        fields: [
          { id: 'count', label: 'Count', type: 'number', min: 0, max: 3 },
          { id: 'ok', label: 'Ok', type: 'checkbox' },
        ],
        defaultValue: [
          { count: 9, ok: true },
          { unknown: 1 },
          { ok: 'nope' },
        ],
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('above max'))).toBe(true);
    expect(result.errors.some((e) => e.includes('unknown child field id'))).toBe(
      true,
    );
  });

  it('rejects duplicate ids, inverted ranges, and missing dropdown sources', () => {
    const duplicate = validateScoresheetSchema(
      canonicalSchema({
        fields: [
          { id: 'name', label: 'A', type: 'text' },
          { id: 'name', label: 'B', type: 'text' },
        ],
      }),
    );
    expect(duplicate.ok).toBe(false);
    expect(duplicate.errors.some((e) => e.includes('not unique'))).toBe(true);

    const range = validateScoresheetFields([
      validNumberField({ min: 10, max: 1, step: 0 }),
    ]);
    expect(range.ok).toBe(false);
    expect(range.errors.some((e) => e.includes('min must be less than or equal to max'))).toBe(
      true,
    );
    expect(range.errors.some((e) => e.includes('step must be greater than 0'))).toBe(
      true,
    );

    const dropdown = validateScoresheetFields([
      { id: 'empty', label: 'Empty', type: 'dropdown' },
    ]);
    expect(dropdown.ok).toBe(false);
    expect(dropdown.errors.some((e) => e.includes('static options or a dataSource'))).toBe(
      true,
    );
  });

  it('rejects derived outputs that do not point at compatible fields', () => {
    const result = validateScoresheetSchema(
      canonicalSchema({
        fields: [
          {
            id: 'stacks',
            label: 'Stacks',
            type: 'repeatableGroup',
            fields: [{ id: 'n', label: 'N', type: 'number' }],
            derived: {
              type: 'botballStartBoxCubes',
              outputs: { subtotal: 'missing' },
            },
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('unknown field'))).toBe(true);
  });

  it('rejects incoherent mode and scoreKind combinations', () => {
    const result = validateScoresheetSchema(
      canonicalSchema({
        mode: 'head-to-head',
        scoreKind: 'double_seeding',
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('cannot be combined'))).toBe(
      true,
    );
  });

  it('rejects unsupported keys and presence-only bracketSource probes', () => {
    expect(
      validateScoresheetSchema(
        canonicalSchema({ queueConfig: { enabled: true } }),
      ).ok,
    ).toBe(false);
    expect(
      validateScoresheetSchema(canonicalSchema({ bracketSource: true })).ok,
    ).toBe(false);
    expect(
      validateScoresheetSchema(
        canonicalSchema({ bracketSource: 'winners' }),
      ).ok,
    ).toBe(false);
    expect(
      validateScoresheetFields([{ name: 'score', type: 'number' }]).ok,
    ).toBe(false);
  });
});

describe('helpers and inferred types', () => {
  it('formats multi-error messages', () => {
    expect(formatSchemaValidationError(['only one'])).toBe('only one');
    expect(formatSchemaValidationError(['a', 'b'])).toContain(
      'Invalid scoresheet schema',
    );
    expect(formatSchemaValidationError(['a', 'b'])).toContain('- a');
  });

  it('reads defaultValue helpers and ignores startValue', () => {
    expect(getFieldDefaultValue({ type: 'text', defaultValue: 'hi' })).toBe(
      'hi',
    );
    expect(
      getFieldDefaultValue({ type: 'text', startValue: 'legacy' }),
    ).toBeUndefined();
    expect(getBlankFieldValue({ type: 'checkbox' })).toBe(false);
    expect(getBlankFieldValue({ type: 'text' })).toBe('');
    expect(getBlankFieldValue({ type: 'number', defaultValue: 3 })).toBe(3);
  });

  it('narrows discriminated field unions', () => {
    const result = parseScoresheetSchema(
      canonicalSchema({
        fields: [
          {
            id: 'winner',
            label: 'Winner',
            type: 'winner-select',
            options: [{ value: 'team_a', label: 'A' }],
          },
          { id: 'name', label: 'Name', type: 'text' },
        ],
      }),
    );
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    const schema: ScoresheetSchema = result.data;
    expect(schema.schemaVersion).toBe(SCORESHEET_SCHEMA_VERSION);
    const winner = schema.fields.find(
      (field): field is Extract<ScoresheetField, { type: 'winner-select' }> =>
        field.type === 'winner-select',
    );
    expect(winner?.options?.[0]?.label).toBe('A');
  });
});
