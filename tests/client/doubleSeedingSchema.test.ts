import { describe, expect, it } from 'vitest';
import { buildDoubleSeedingSchema } from '../../src/client/components/scoresheetUtils';
import { isTeamInitialsFieldId } from '../../src/shared/teamInitials';

interface SchemaField {
  id: string;
  type: string;
  formula?: string;
}

describe('buildDoubleSeedingSchema', () => {
  it('builds schemas with the explicit double-seeding marker and no winner selection', () => {
    const schema = buildDoubleSeedingSchema({
      title: 'Double Seeding Sheet',
      eventId: 42,
      templateFields: null,
    });

    expect(schema.scoreKind).toBe('double_seeding');
    expect(schema.scoreDestination).toBe('db');
    expect(schema.requireTeamInitials).toBe(true);
    expect(schema.eventId).toBe(42);
    // Never head-to-head: that means bracket scoring with a winner
    expect(schema.mode).toBeUndefined();
    expect(schema.bracketSource).toBeUndefined();

    const fields = schema.fields as SchemaField[];
    expect(fields.some((f) => f.type === 'winner-select')).toBe(false);
    expect(fields.some((f) => f.id === 'team_a_number')).toBe(true);
    expect(fields.some((f) => f.id === 'team_b_number')).toBe(true);
  });

  it('keeps side-specific totals instead of a combined grand_total', () => {
    const schema = buildDoubleSeedingSchema({
      title: 'Double Seeding Sheet',
      eventId: 7,
      templateFields: null,
    });

    const fields = schema.fields as SchemaField[];
    expect(fields.some((f) => f.id === 'team_a_total')).toBe(true);
    expect(fields.some((f) => f.id === 'team_b_total')).toBe(true);
    expect(fields.some((f) => f.id === 'grand_total')).toBe(false);
  });

  it('adapts side A/B template fields to team A/B without a winner field', () => {
    const schema = buildDoubleSeedingSchema({
      title: 'Adapted Sheet',
      eventId: 7,
      templateFields: [
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
      ],
    });

    const fields = schema.fields as SchemaField[];
    expect(fields.some((f) => f.id === 'team_a_score')).toBe(true);
    expect(fields.some((f) => f.id === 'team_a_total')).toBe(true);
    expect(fields.some((f) => f.id === 'team_b_total')).toBe(true);
    expect(fields.some((f) => f.type === 'winner-select')).toBe(false);
    expect(fields.find((f) => f.id === 'team_a_total')?.formula).toBe(
      'team_a_score',
    );
  });

  it('strips template initials fields instead of keeping them as scoring inputs', () => {
    const schema = buildDoubleSeedingSchema({
      title: 'Adapted Sheet',
      eventId: 7,
      templateFields: [
        { id: 'side_a_score', label: 'Side A Score', type: 'number' },
        {
          id: 'side_a_team_initials',
          label: 'Team Initials',
          type: 'text',
          required: true,
        },
        {
          id: 'side_b_team_initials',
          label: 'Team Initials',
          type: 'text',
          required: true,
        },
      ],
    });

    const fields = schema.fields as SchemaField[];
    expect(fields.some((field) => isTeamInitialsFieldId(field.id))).toBe(false);
    expect(fields.some((field) => field.id === 'team_a_score')).toBe(true);
  });
});
