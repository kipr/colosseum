import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compileScoresheetFormulas } from '../../src/shared/scoresheetFormulaProgram';
import {
  calculateScoresheetValues,
  buildDoubleEliminationSchema,
  buildDoubleSeedingSchema,
  buildRepeatableGroupDerivedOutputScoreEntries,
} from '../../src/client/components/scoresheetUtils';
import type { ScoresheetField } from '../../src/shared/scoresheetSchema';

function fixture(name: string): ScoresheetField[] {
  const value = JSON.parse(readFileSync(`templates/${name}`, 'utf8'));
  return Array.isArray(value)
    ? value
    : (value.schema?.fields ?? value.fields ?? []);
}

describe('scoresheet formula schema adapter', () => {
  it('uses only own input properties, including Object prototype names', () => {
    const fields: ScoresheetField[] = [
      { id: 'constructor', type: 'number' },
      { id: 'total', type: 'calculated', formula: 'constructor+1' },
    ];
    expect(calculateScoresheetValues(fields, {}).values.total).toBe(1);
    expect(
      calculateScoresheetValues(fields, { constructor: 4 }).values.total,
    ).toBe(5);
  });

  for (const name of readdirSync('templates').filter((name) =>
    name.endsWith('.json'),
  )) {
    it(`compiles and evaluates ${name}, including generated bracket and double-seeding fields`, () => {
      const fields = fixture(name);
      for (const effectiveFields of [
        fields,
        buildDoubleEliminationSchema({
          title: name,
          eventId: 1,
          templateFields: name.endsWith('-fields.json') ? fields : undefined,
        }).fields,
        buildDoubleSeedingSchema({
          title: name,
          eventId: 1,
          templateFields: name.endsWith('-fields.json') ? fields : undefined,
        }).fields,
      ]) {
        const compilation = compileScoresheetFormulas(effectiveFields);
        expect(compilation).toMatchObject({ ok: true });
        expect(
          calculateScoresheetValues(effectiveFields, {}, compilation),
        ).toMatchObject({ ok: true, errors: [] });
      }
    });
  }
  it('scores representative GCER rows, button multipliers, and derived/formula overlaps', () => {
    const fields = fixture('botball-gcer-2026-scoring-fields.json');
    const result = calculateScoresheetValues(fields, {
      side_a_ls_cube_stacks: [
        { cube_type: 'small', quantity: 2, on_pallet: true },
      ],
      side_a_ls_poms: 3,
      side_a_ls_drum_mult: '1',
      side_a_ild_cube_stacks: [
        { has_pallet: true, small_red: 2 },
        { large_brown: 1 },
      ],
      side_a_uw_clean_deck: '100',
      side_a_uw_robots_mult: '0',
      side_a_total: 999999,
      side_a_ild_subtotal: 999999,
    });
    expect(result.ok).toBe(true);
    // Lower start: (20 cube points + 6 pom points) * 2 = 52.
    // Internal dock: two sorted red cubes * 30 + eight brown equivalents * 10 = 140.
    expect(result.values).toMatchObject({
      side_a_ls_subtotal: 52,
      side_a_ild_subtotal: 140,
      side_a_uw_subtotal: 100,
      side_a_total: 292,
      side_b_total: 0,
    });
  });
  it('respects effective schema changes without stale totals', () => {
    const input: ScoresheetField = { id: 'a', type: 'number' };
    const first: ScoresheetField[] = [
      input,
      { id: 'total', type: 'calculated', formula: 'a+1' },
    ];
    const second: ScoresheetField[] = [
      input,
      { id: 'total', type: 'calculated', formula: 'a*3' },
    ];
    expect(calculateScoresheetValues(first, { a: 2 }).values.total).toBe(3);
    expect(
      calculateScoresheetValues(second, { a: 2, total: 3 }).values.total,
    ).toBe(6);
    expect(
      calculateScoresheetValues(second, { a: { value: 2 }, total: 3 }),
    ).toMatchObject({ ok: false, values: {} });
  });
  it('rejects row formulas and duplicate row IDs without merging row namespaces', () => {
    const row = {
      id: 'rows',
      type: 'repeatableGroup',
      fields: [{ id: 'a', type: 'calculated', formula: '1+' }],
    };
    expect(compileScoresheetFormulas([row])).toMatchObject({
      ok: false,
      errors: [{ code: 'ROW_FORMULA_UNSUPPORTED' }],
    });
    expect(
      compileScoresheetFormulas([
        {
          ...row,
          fields: [
            { id: 'a', type: 'number' },
            { id: 'a', type: 'number' },
          ],
        },
      ]).ok,
    ).toBe(false);
    expect(
      compileScoresheetFormulas([
        { ...row, fields: [{ id: 'a', type: 'number' }] },
        { id: 'a', type: 'number' },
      ]).ok,
    ).toBe(true);
  });

  it('does not expose row children in the scalar namespace', () => {
    expect(
      compileScoresheetFormulas([
        {
          id: 'rows',
          type: 'repeatableGroup',
          fields: [{ id: 'count', type: 'number' }],
        },
        { id: 'total', type: 'calculated', formula: 'count' },
      ]),
    ).toMatchObject({ ok: false, errors: [{ code: 'UNKNOWN_REFERENCE' }] });
  });
  it('rejects duplicate producers and editable/output collisions', () => {
    const group = {
      id: 'rows',
      type: 'repeatableGroup',
      derived: {
        type: 'botballStartBoxCubes',
        outputs: { subtotal: 'points' },
      },
    };
    expect(
      compileScoresheetFormulas([group, { ...group, id: 'other' }]).ok,
    ).toBe(false);
    expect(
      compileScoresheetFormulas([group, { id: 'points', type: 'number' }]).ok,
    ).toBe(false);
    expect(
      compileScoresheetFormulas([
        { id: 'a', type: 'text' },
        { id: 'a', type: 'number' },
      ]).ok,
    ).toBe(false);
    expect(
      compileScoresheetFormulas([group, { id: 'points', type: 'calculated' }])
        .ok,
    ).toBe(true);
  });
  it('does not overwrite a formula result with its derived producer during serialization', () => {
    const fields: ScoresheetField[] = [
      { id: 'points', type: 'calculated', formula: '2' },
    ];
    const group: ScoresheetField = {
      id: 'rows',
      type: 'repeatableGroup',
      derived: {
        type: 'botballStartBoxCubes',
        outputs: { subtotal: 'points' },
      },
    };
    expect(
      buildRepeatableGroupDerivedOutputScoreEntries(
        group,
        { subtotal: 99 },
        fields,
      ),
    ).toEqual({});
    expect(
      calculateScoresheetValues([group, ...fields], { rows: [], points: 99 })
        .values.points,
    ).toBe(2);
  });
});
