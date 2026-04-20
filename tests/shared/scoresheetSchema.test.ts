/**
 * Round-trip and rejection tests for the canonical scoresheet schema.
 */
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  parseScoresheetSchema,
  scoresheetFieldSchema,
  tryParseScoresheetSchema,
} from '../../src/shared/domain/scoresheetSchema';
import {
  buildDoubleEliminationSchema,
  buildSeedingSchema,
} from '../../src/client/components/scoresheetUtils';

describe('scoresheetSchema', () => {
  it('parses a minimal seeding schema', () => {
    const parsed = parseScoresheetSchema({
      title: 'Seeding',
      fields: [
        { id: 'team', label: 'Team', type: 'text', required: true },
        { id: 'round', label: 'Round', type: 'number', min: 1, step: 1 },
      ],
    });
    expect(parsed.fields).toHaveLength(2);
    expect(parsed.fields[0].type).toBe('text');
  });

  it('parses a full DE schema produced by buildDoubleEliminationSchema', () => {
    const schema = buildDoubleEliminationSchema({
      title: 'DE',
      eventId: 1,
      templateFields: null,
    });
    const parsed = parseScoresheetSchema(schema);
    expect(parsed.mode).toBe('head-to-head');
    expect(parsed.bracketSource?.type).toBe('db');
    expect(parsed.fields.find((f) => f.type === 'winner-select')).toBeDefined();
  });

  it('parses a full seeding schema produced by buildSeedingSchema', () => {
    const schema = buildSeedingSchema({
      title: 'Seeding',
      eventId: 7,
      templateFields: null,
    });
    const parsed = parseScoresheetSchema(schema);
    expect(parsed.fields.find((f) => f.id === 'team_number')).toBeDefined();
    expect(parsed.fields.find((f) => f.isGrandTotal)).toBeDefined();
  });

  it('parses the e2e all-field-types sample', () => {
    const sample = {
      title: 'All Field Types',
      layout: 'two-column',
      fields: [
        {
          id: 'judge_name',
          label: 'Judge Name',
          type: 'text',
          required: true,
          placeholder: 'Enter your name',
        },
        {
          id: 'comments',
          label: 'Comments',
          type: 'text',
          placeholder: 'Optional feedback',
        },
        {
          id: 'division',
          label: 'Division',
          type: 'dropdown',
          required: true,
          options: [
            { label: 'Junior', value: 'junior' },
            { label: 'Senior', value: 'senior' },
          ],
        },
        {
          id: 'technical_score',
          label: 'Technical Score',
          type: 'number',
          column: 'left',
          min: 0,
          max: 100,
          step: 1,
        },
        {
          id: 'attempts',
          label: 'Attempts',
          type: 'buttons',
          column: 'right',
          options: [
            { label: '1', value: 1 },
            { label: '2', value: 2 },
            { label: '3', value: 3 },
          ],
        },
        {
          id: 'completed',
          label: 'Completed?',
          type: 'checkbox',
        },
        {
          id: 'total',
          label: 'Total',
          type: 'calculated',
          formula: 'technical_score',
          isTotal: true,
        },
      ],
    };
    const parsed = parseScoresheetSchema(sample);
    expect(parsed.fields).toHaveLength(7);
  });

  it('rejects fields with an unknown type via parseScoresheetSchema', () => {
    expect(() =>
      parseScoresheetSchema({
        fields: [{ id: 'x', label: 'X', type: 'unknown' }],
      }),
    ).toThrow(ZodError);
  });

  it('rejects schemas without a fields array', () => {
    expect(() => parseScoresheetSchema({ title: 'No fields' })).toThrow(
      ZodError,
    );
  });

  it('returns ok=false for invalid input via tryParseScoresheetSchema', () => {
    const result = tryParseScoresheetSchema({
      fields: [{ id: 'x', label: 'X', type: 'oops' }],
    });
    expect(result.ok).toBe(false);
  });

  it('returns ok=true for valid input via tryParseScoresheetSchema', () => {
    const result = tryParseScoresheetSchema({ fields: [] });
    expect(result.ok).toBe(true);
  });

  it('requires options on a buttons field', () => {
    expect(() =>
      scoresheetFieldSchema.parse({ id: 'b', label: 'B', type: 'buttons' }),
    ).toThrow(ZodError);
  });

  it('requires a formula on a calculated field', () => {
    expect(() =>
      scoresheetFieldSchema.parse({
        id: 'c',
        label: 'Calc',
        type: 'calculated',
      }),
    ).toThrow(ZodError);
  });
});
