import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calculateFormulaValues } from '../../src/client/components/scoresheetUtils';
import { validateScoresheetFields } from '../../src/shared/scoresheetSchema';

const fields = JSON.parse(
  readFileSync('templates/botball-fall-workbook-seeding-draft.json', 'utf8'),
);
const score = (data: Record<string, number>) =>
  calculateFormulaValues(fields, data).calculated;

describe('Botball Fall workbook draft', () => {
  it('validates and scores an empty board as zero with a 1x multiplier', () => {
    expect(Array.isArray(fields)).toBe(true);
    expect(
      fields.some((field: { id: string }) =>
        ['team_number', 'team_name', 'round'].includes(field.id),
      ),
    ).toBe(false);
    expect(validateScoresheetFields(fields)).toEqual({ ok: true, errors: [] });
    expect(score({})).toMatchObject({ multiplier: 1, grand_total: 0 });
  });

  it.each([
    [0, 0, 0],
    [0, 1, 0],
    [0, 2, 4],
    [0, 5, 25],
    [1, 5, 1],
    [4, 0, 4],
    [5, 5, 25],
  ])('preserves pom priority for same=%i unique=%i', (same, unique, bonus) => {
    for (let zone = 1; zone <= 5; zone++) {
      expect(
        score({ [`zone_${zone}_same`]: same, [`zone_${zone}_unique`]: unique })[
          `zone_${zone}_bonus`
        ],
      ).toBe(bonus);
    }
  });

  it.each([0, 1, 2, 3, 4, 5])(
    'applies %i qualifying zones to the whole subtotal',
    (count) => {
      const data: Record<string, number> = {
        base_objects: 10,
        pickleballs: 2,
        rings_touching: 3,
        rings_neck: 1,
        ducks_under: 2,
        cups_nested: 1,
        cups_upright: 2,
        botguy: 1,
        big_duck: 1,
        mystery_pom: 1,
        zone_1_same: 5,
        zone_2_unique: 3,
      };
      for (let zone = 1; zone <= 5; zone++) {
        data[`zone_${zone}_duck`] = zone <= count ? 1 : 0;
      }
      // Objects: 194. Pom zones: 25 + 9. Both receive the duck multiplier.
      expect(score(data)).toMatchObject({
        object_subtotal: 194,
        round_subtotal: 228,
        qualifying_zones: count,
        multiplier: Math.max(1, count),
        grand_total: 228 * Math.max(1, count),
      });
    },
  );
});
