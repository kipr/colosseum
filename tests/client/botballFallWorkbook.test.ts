import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateFormulaValues } from '../../src/client/components/scoresheetUtils';
import { validateScoresheetFields } from '../../src/shared/scoresheetSchema';
import workbook from '../fixtures/botball-fall-workbook.json';

const fields = JSON.parse(
  readFileSync('templates/botball-26-27-fall-scoring-fields.json', 'utf8'),
);
const objects = [
  'base_objects',
  'pickleballs',
  'rings_touching',
  'rings_neck',
  'ducks_under',
  'cups_nested',
  'cups_upright',
  'botguy',
  'big_duck',
  'mystery_pom',
];
const inputs: Record<string, string> = {};
const outputs: Record<string, string> = {};
objects.forEach((id, i) => {
  inputs[id] = `C${9 + i}`;
  outputs[`${id}_points`] = `E${9 + i}`;
});
for (let zone = 1; zone <= 5; zone++) {
  inputs[`zone_${zone}_same`] = `B${21 + zone}`;
  inputs[`zone_${zone}_unique`] = `C${21 + zone}`;
  inputs[`zone_${zone}_duck`] = `B${31 + zone}`;
  outputs[`zone_${zone}_bonus`] = `E${21 + zone}`;
}
Object.assign(outputs, {
  round_subtotal: 'E28',
  qualifying_zones: 'B37',
  multiplier: 'B38',
  grand_total: 'E40',
});

// Evaluate the extracted Excel formulas, independently of the template's JS
// formulas. Only the arithmetic/functions present in this workbook are needed.
// Keep the fixture's formulas intact so a transcription error cannot be hidden
// by a second hand-written implementation of the game's scoring rules.
const cells: Record<string, { value: string | number; formula?: string }> =
  workbook.cells;
function excelScore(data: Record<string, unknown>) {
  const values: Record<string, number> = {};
  for (const [id, cell] of Object.entries(inputs)) {
    values[cell] = Number(data[id] || 0);
  }
  function cellValue(address: string): number {
    if (address in values) return values[address];
    const cell = cells[address];
    if (!cell) throw new Error(`Missing workbook cell ${address}`);
    if (!cell.formula) return Number(cell.value);
    const expression = cell.formula
      .replace(/([A-Z]+)(\d+):\1(\d+)/g, (_, column, start, end) =>
        Array.from(
          { length: Number(end) - Number(start) + 1 },
          (_, i) => `${column}${Number(start) + i}`,
        ).join(','),
      )
      .replace(/\b[A-Z]+\d+\b/g, (address) => String(cellValue(address)))
      .replace(/\^/g, '**')
      .replace(/(?<![<>])=(?!=)/g, '===');
    const result = new Function(
      'IF',
      'SUM',
      'MIN',
      'MAX',
      `return ${expression}`,
    )(
      (condition: boolean, yes: number, no: number) => (condition ? yes : no),
      (...args: number[]) => args.reduce((a, b) => a + b, 0),
      Math.min,
      Math.max,
    );
    values[address] = result;
    return result;
  }
  const result = Object.fromEntries(
    Object.entries(outputs).map(([id, cell]) => [id, cellValue(cell)]),
  );
  result.object_subtotal = objects.reduce(
    (sum, _, i) => sum + cellValue(`E${9 + i}`),
    0,
  );
  return result;
}
function check(data: Record<string, unknown>) {
  expect(
    calculateFormulaValues(fields, data).calculated,
    JSON.stringify(data),
  ).toEqual(excelScore(data));
}
const duckMask = (mask: number) =>
  Object.fromEntries(
    Array.from({ length: 5 }, (_, i) => [
      `zone_${i + 1}_duck`,
      (mask >> i) & 1,
    ]),
  );

describe('Botball 26–27 Fall workbook parity', () => {
  it('records the exact supplied workbook and its zero/default cached results', () => {
    // The user-supplied binary is optional; the extracted fixture keeps CI
    // independent of an untracked local file. Detect changed source locally.
    if (existsSync(workbook.source)) {
      expect(
        createHash('sha256')
          .update(readFileSync(workbook.source))
          .digest('hex'),
      ).toBe(workbook.sha256);
    }
    for (const [id, cell] of Object.entries(inputs)) {
      expect(
        fields.find((field: { id: string }) => field.id === id)?.defaultValue,
      ).toBe(cells[cell].value);
    }
    const expected = excelScore({});
    for (const [id, cell] of Object.entries(outputs))
      expect(expected[id]).toBe(cells[cell].value);
    check({});
  });

  it('has exactly the workbook inputs and outputs, valid bounds, and one grand total', () => {
    expect(validateScoresheetFields(fields)).toEqual({ ok: true, errors: [] });
    expect(new Set(fields.map((f: { id: string }) => f.id)).size).toBe(
      fields.length,
    );
    const interactive = fields.filter((f: { type: string }) =>
      ['number', 'buttons'].includes(f.type),
    );
    expect(interactive.map((f: { id: string }) => f.id).sort()).toEqual(
      Object.keys(inputs).sort(),
    );
    expect(
      fields
        .filter((f: { type: string }) => f.type === 'calculated')
        .map((f: { id: string }) => f.id)
        .sort(),
    ).toEqual([...Object.keys(outputs), 'object_subtotal'].sort());
    expect(
      fields
        .filter((f: { isGrandTotal?: boolean }) => f.isGrandTotal)
        .map((f: { id: string }) => f.id),
    ).toEqual(['grand_total']);
    for (const field of interactive) {
      const binary =
        ['cups_nested', 'botguy', 'big_duck', 'mystery_pom'].includes(
          field.id,
        ) || field.id.endsWith('_duck');
      expect(field.type).toBe(binary ? 'buttons' : 'number');
      if (field.type === 'buttons') {
        expect(field.options).toEqual([
          { label: 'No', value: 0 },
          { label: 'Yes', value: 1 },
        ]);
      } else {
        expect(field.min).toBe(0);
        expect(field.step).toBe(1);
        expect(field.max).toBe(
          field.id.startsWith('zone_')
            ? 5
            : field.id === 'cups_upright'
              ? 2
              : undefined,
        );
      }
      if (objects.includes(field.id)) {
        const row = 9 + objects.indexOf(field.id);
        expect(field.suffix).toBe(`× ${cells[`D${row}`].value}`);
      }
    }
    // A later dependency silently becomes zero in the production evaluator.
    const seen = new Set(Object.keys(inputs));
    for (const field of fields) {
      if (field.type !== 'calculated') continue;
      for (const dependency of field.formula.match(/[a-z_][a-z0-9_]*/g) || [])
        expect(seen.has(dependency), `${field.id} needs ${dependency}`).toBe(
          true,
        );
      seen.add(field.id);
    }
  });

  it('matches every pair of allowed pom counts in every zone, including conflicting counts', () => {
    for (let zone = 1; zone <= 5; zone++) {
      for (let same = 0; same <= 5; same++) {
        for (let unique = 0; unique <= 5; unique++) {
          check({
            [`zone_${zone}_same`]: same,
            [`zone_${zone}_unique`]: unique,
          });
        }
      }
    }
  });

  it('matches each object bonus independently with every duck-zone pattern', () => {
    for (const id of objects) {
      const field = fields.find((f: { id: string }) => f.id === id);
      const counts =
        field.type === 'buttons'
          ? [0, 1]
          : field.max === 2
            ? [0, 1, 2]
            : [0, 1, 2, 5, 25, 100];
      for (const count of counts)
        for (let mask = 0; mask < 32; mask++)
          check({ [id]: count, ...duckMask(mask) });
    }
  });

  it('preserves simultaneous cup/other bonuses and whole-round multiplication', () => {
    // All combinations of the four binary object conditions and cup count.
    for (let flags = 0; flags < 16; flags++) {
      for (let cups = 0; cups <= 2; cups++) {
        for (let mask = 0; mask < 32; mask++) {
          check({
            base_objects: 10,
            pickleballs: 2,
            rings_touching: 3,
            rings_neck: 1,
            ducks_under: 2,
            cups_nested: flags & 1,
            botguy: (flags >> 1) & 1,
            big_duck: (flags >> 2) & 1,
            mystery_pom: (flags >> 3) & 1,
            cups_upright: cups,
            zone_1_same: 5,
            zone_2_unique: 3,
            zone_3_same: 1,
            zone_3_unique: 5,
            zone_4_unique: 1,
            zone_5_unique: 4,
            ...duckMask(mask),
          });
        }
      }
    }
  });

  it('matches 512 reproducible mixed boards with numeric and form-string inputs', () => {
    let seed = 0xb07ba11;
    const random = (max: number) => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % (max + 1);
    };
    for (let run = 0; run < 512; run++) {
      const data: Record<string, unknown> = {};
      for (const id of Object.keys(inputs)) {
        const field = fields.find((f: { id: string }) => f.id === id);
        const value = random(field.type === 'buttons' ? 1 : (field.max ?? 50));
        data[id] = run % 2 ? String(value) : value;
      }
      check(data);
    }
    check(Object.fromEntries(Object.keys(inputs).map((id) => [id, ''])));
  });
});
