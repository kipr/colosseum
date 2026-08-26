import { describe, expect, it } from 'vitest';
import {
  buildDoubleSeedingSchema,
  shouldHideSoloDoubleSeedingField,
} from '../../src/client/components/scoresheetUtils';
import {
  parseScoresheetSchema,
  SCORESHEET_SCHEMA_VERSION,
  type ScoresheetField,
} from '../../src/shared/scoresheetSchema';

describe('buildDoubleSeedingSchema', () => {
  it('builds schemas with the explicit double-seeding marker and no winner selection', () => {
    const schema = buildDoubleSeedingSchema({
      title: 'Double Seeding Sheet',
      eventId: 42,
      templateFields: null,
    });

    expect(schema.schemaVersion).toBe(SCORESHEET_SCHEMA_VERSION);
    expect(schema.scoreKind).toBe('double_seeding');
    expect(schema.scoreDestination).toBe('db');
    expect(schema.eventId).toBe(42);
    // Never head-to-head: that means bracket scoring with a winner
    expect(schema.mode).toBeUndefined();
    expect(schema.bracketSource).toBeUndefined();
    expect(parseScoresheetSchema(schema).success).toBe(true);

    expect(schema.fields.some((f) => f.type === 'winner-select')).toBe(false);
    expect(schema.fields.some((f) => f.id === 'team_a_number')).toBe(true);
    expect(schema.fields.some((f) => f.id === 'team_b_number')).toBe(true);
  });

  it('keeps side-specific totals instead of a combined grand_total', () => {
    const schema = buildDoubleSeedingSchema({
      title: 'Double Seeding Sheet',
      eventId: 7,
      templateFields: null,
    });

    expect(schema.fields.some((f) => f.id === 'team_a_total')).toBe(true);
    expect(schema.fields.some((f) => f.id === 'team_b_total')).toBe(true);
    expect(schema.fields.some((f) => f.id === 'grand_total')).toBe(false);
  });

  it('adapts side A/B template fields to team A/B without a winner field', () => {
    const templateFields: ScoresheetField[] = [
      { id: 'side_a_score', label: 'Side A Score', type: 'number' },
      {
        id: 'side_a_total',
        label: 'Side A Total',
        type: 'calculated',
        formula: 'side_a_score',
      },
      {
        id: 'side_b_total',
        label: 'Side B Total',
        type: 'calculated',
        formula: 'side_b_score',
      },
    ];
    const schema = buildDoubleSeedingSchema({
      title: 'Adapted Sheet',
      eventId: 7,
      templateFields,
    });

    expect(parseScoresheetSchema(schema).success).toBe(true);
    expect(schema.fields.some((f) => f.id === 'team_a_score')).toBe(true);
    expect(schema.fields.some((f) => f.id === 'team_a_total')).toBe(true);
    expect(schema.fields.some((f) => f.id === 'team_b_total')).toBe(true);
    expect(schema.fields.some((f) => f.type === 'winner-select')).toBe(false);
    const teamATotal = schema.fields.find((f) => f.id === 'team_a_total');
    expect(teamATotal?.type).toBe('calculated');
    if (teamATotal?.type === 'calculated') {
      expect(teamATotal.formula).toBe('team_a_score');
    }
  });

  it('hides only side-B initials for solo double-seeding matches', () => {
    const soloFormData = {
      double_seeding_match_id: 12,
      team_a_id: 1,
      team_b_id: undefined,
    };

    expect(
      shouldHideSoloDoubleSeedingField(
        'team_b_team_initials',
        soloFormData,
        true,
      ),
    ).toBe(true);
    expect(
      shouldHideSoloDoubleSeedingField(
        'side_b_team_initials',
        soloFormData,
        true,
      ),
    ).toBe(true);
    expect(
      shouldHideSoloDoubleSeedingField('team_b_score', soloFormData, true),
    ).toBe(false);
    expect(
      shouldHideSoloDoubleSeedingField(
        'team_b_team_initials',
        { ...soloFormData, team_b_id: 2 },
        true,
      ),
    ).toBe(false);
    expect(
      shouldHideSoloDoubleSeedingField(
        'team_b_team_initials',
        soloFormData,
        false,
      ),
    ).toBe(false);
  });
});
