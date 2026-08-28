import { describe, expect, it } from 'vitest';
import fallFields from '../../templates/botball-2026-fall-scoring-fields.json';
import standardFields from '../../templates/botball-2026-scoring-fields.json';
import gcerFields from '../../templates/botball-gcer-2026-scoring-fields.json';
import seedingTemplate from '../../templates/legacy/botball-seeding-template.json';

describe('section multipliers', () => {
  it.each([
    ['fall', fallFields],
    ['seeding', seedingTemplate.fields],
  ])('adds Pom Sorter multipliers in the %s template', (_, fields) => {
    for (const side of ['a', 'b']) {
      const prefix = `side_${side}_pom`;
      const formula = fields.find(
        (field) => field.id === `${prefix}_subtotal`,
      )?.formula;

      expect(formula).toContain(
        `${prefix}_sorted_baskets : 1) + (${prefix}_returned_baskets`,
      );
    }
  });

  it.each([
    ['standard', standardFields],
    ['GCER', gcerFields],
  ])('adds every pair of multipliers in the %s template', (name, fields) => {
    for (const side of ['a', 'b']) {
      const lowerStartBox = fields.find(
        (field) => field.id === `side_${side}_ls_subtotal`,
      )?.formula;
      const pomBaskets = fields.find(
        (field) => field.id === `side_${side}_pb_subtotal`,
      )?.formula;

      expect(lowerStartBox).toContain(
        `side_${side}_ls_drum_mult === '1' ? 2 : ${name === 'GCER' ? 0 : 1}) + (side_${side}_ls_botguy_mult`,
      );
      expect(pomBaskets).toContain(
        name === 'GCER'
          ? `side_${side}_pb_sorted_baskets_mult + 1 : 0) + (side_${side}_pb_returned_baskets_mult`
          : `side_${side}_pb_sorted_baskets_mult + 1) + (side_${side}_pb_returned_baskets_mult`,
      );
    }
  });
});
