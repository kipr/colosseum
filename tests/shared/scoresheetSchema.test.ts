import { describe, expect, it } from 'vitest';
import {
  formatSchemaValidationError,
  getBlankFieldValue,
  getFieldDefaultValue,
  parseCanonicalScoresheetSchema,
  validateScoresheetFields,
  validateScoresheetSchema,
} from '../../src/shared/scoresheetSchema';

describe('scoresheetSchema defaultValue validation', () => {
  it('requires a supported kind and rejects legacy markers', () => {
    expect(validateScoresheetSchema({ mode: 'head-to-head' }).ok).toBe(false);
    expect(validateScoresheetSchema({ fields: [] }).ok).toBe(false);
    expect(
      validateScoresheetSchema({ kind: 'seeding', scoreKind: 'double_seeding' })
        .ok,
    ).toBe(false);
    expect(
      validateScoresheetSchema({
        kind: 'bracket',
        bracketSource: { type: 'db' },
      }),
    ).toEqual({ ok: true, errors: [] });
    expect(validateScoresheetSchema({ kind: 'seeding' })).toEqual({
      ok: true,
      errors: [],
    });
  });

  it('rejects non-object schemas and non-array fields', () => {
    expect(validateScoresheetSchema(null).ok).toBe(false);
    expect(validateScoresheetSchema({ fields: 'x' }).errors[0]).toContain(
      'schema.fields must be an array',
    );
    expect(validateScoresheetFields('nope').ok).toBe(false);
  });

  it('accepts valid typed defaults for interactive fields', () => {
    const result = validateScoresheetSchema({
      kind: 'seeding',
      fields: [
        { id: 'name', type: 'text', defaultValue: 'Ada' },
        { id: 'score', type: 'number', min: 0, max: 10, defaultValue: 7 },
        {
          id: 'division',
          type: 'dropdown',
          options: [
            { label: 'Junior', value: 'junior' },
            { label: 'Senior', value: 'senior' },
          ],
          defaultValue: 'senior',
        },
        {
          id: 'rating',
          type: 'buttons',
          options: [
            { label: 'Good', value: '4' },
            { label: 'Fair', value: '3' },
          ],
          defaultValue: '4',
        },
        { id: 'dq', type: 'checkbox', defaultValue: true },
        {
          id: 'team',
          type: 'dropdown',
          dataSource: { type: 'db', endpoint: '/teams' },
          defaultValue: 42,
        },
        {
          id: 'stacks',
          type: 'repeatableGroup',
          fields: [
            { id: 'count', type: 'number', min: 0, max: 5 },
            { id: 'notes', type: 'text' },
          ],
          defaultValue: [{ count: 2, notes: 'ok' }],
        },
      ],
    });

    expect(result).toEqual({ ok: true, errors: [] });
  });

  it('rejects startValue and type mismatches', () => {
    const result = validateScoresheetFields([
      { id: 'legacy', type: 'text', startValue: 'old' },
      { id: 'name', type: 'text', defaultValue: 1 },
      { id: 'score', type: 'number', defaultValue: '5' },
      { id: 'score_nan', type: 'number', defaultValue: Number.NaN },
      { id: 'score_low', type: 'number', min: 1, defaultValue: 0 },
      { id: 'score_high', type: 'number', max: 5, defaultValue: 9 },
      { id: 'flag', type: 'checkbox', defaultValue: 'yes' },
      {
        id: 'division',
        type: 'dropdown',
        options: [{ label: 'Junior', value: 'junior' }],
        defaultValue: 'senior',
      },
      {
        id: 'rating',
        type: 'buttons',
        options: [{ label: 'Good', value: '4' }],
        defaultValue: '9',
      },
      { id: 'missing_type', defaultValue: 'x' },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('startValue'))).toBe(true);
    expect(result.errors.some((e) => e.includes('must be a string'))).toBe(
      true,
    );
    expect(result.errors.some((e) => e.includes('finite number'))).toBe(true);
    expect(result.errors.some((e) => e.includes('below min'))).toBe(true);
    expect(result.errors.some((e) => e.includes('above max'))).toBe(true);
    expect(result.errors.some((e) => e.includes('boolean'))).toBe(true);
    expect(
      result.errors.some((e) => e.includes('match one of the declared options')),
    ).toBe(true);
    expect(result.errors.some((e) => e.includes('must include a "type"'))).toBe(
      true,
    );
  });

  it('rejects defaults on calculated, header, and winner-select fields', () => {
    const result = validateScoresheetFields([
      { id: 'total', type: 'calculated', formula: 'a+b', defaultValue: 0 },
      { type: 'section_header', label: 'A', defaultValue: 'x' },
      { type: 'group_header', label: 'B', defaultValue: 'y' },
      { id: 'winner', type: 'winner-select', defaultValue: 'a' },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors).toHaveLength(4);
    result.errors.forEach((error) => {
      expect(error).toContain('does not support defaultValue');
    });
  });

  it('validates repeatableGroup default rows recursively', () => {
    const result = validateScoresheetFields([
      {
        id: 'stacks',
        type: 'repeatableGroup',
        fields: [
          { id: 'count', type: 'number', min: 0, max: 3 },
          { id: 'ok', type: 'checkbox' },
        ],
        defaultValue: [
          { count: 9, ok: true },
          'bad-row',
          { unknown: 1 },
          { ok: 'nope' },
        ],
      },
    ]);

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('above max'))).toBe(true);
    expect(result.errors.some((e) => e.includes('each row must be an object'))).toBe(
      true,
    );
    expect(result.errors.some((e) => e.includes('unknown child field id'))).toBe(
      true,
    );
    expect(result.errors.some((e) => e.includes('must be a boolean'))).toBe(
      true,
    );
  });

  it('formats multi-error messages', () => {
    expect(formatSchemaValidationError(['only one'])).toBe('only one');
    expect(formatSchemaValidationError(['a', 'b'])).toContain('Invalid scoresheet schema');
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
    expect(
      getBlankFieldValue({ type: 'number', defaultValue: 3 }),
    ).toBe(3);
  });

  it('parses canonical schemas and rejects legacy or missing kind', () => {
    expect(
      parseCanonicalScoresheetSchema({
        kind: 'seeding',
        fields: [],
      }),
    ).toEqual({
      ok: true,
      schema: { kind: 'seeding', fields: [] },
    });
    expect(parseCanonicalScoresheetSchema('{"kind":"seeding"}').ok).toBe(true);
    expect(parseCanonicalScoresheetSchema('{').ok).toBe(false);
    expect(parseCanonicalScoresheetSchema({ fields: [] }).ok).toBe(false);
    expect(
      parseCanonicalScoresheetSchema({
        kind: 'bracket',
        mode: 'head-to-head',
        bracketSource: { type: 'db' },
      }).ok,
    ).toBe(false);
  });
});
