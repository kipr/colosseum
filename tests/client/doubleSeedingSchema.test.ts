import { describe, expect, it } from 'vitest';
import { buildDoubleSeedingSchema } from '../../src/client/components/scoresheetUtils';

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

  it('builds the full fallback schema when there is no template', () => {
    expect(
      buildDoubleSeedingSchema({
        title: 'Fallback Sheet',
        eventId: 42,
        templateFields: null,
      }),
    ).toEqual({
      layout: 'two-column',
      scoreKind: 'double_seeding',
      title: 'Fallback Sheet',
      eventId: 42,
      scoreDestination: 'db',
      teamInitials: { required: true },
      teamsDataSource: {
        type: 'db',
        eventId: 42,
        teamNumberField: 'team_number',
        teamNameField: 'team_name',
      },
      fields: [
        {
          id: 'team_a_number',
          label: 'Team A Number',
          type: 'text',
          required: true,
          autoPopulated: true,
          placeholder: 'Select match first',
        },
        {
          id: 'team_a_name',
          label: 'Team A Name',
          type: 'text',
          required: true,
          autoPopulated: true,
          placeholder: 'Select match first',
        },
        {
          id: 'team_b_number',
          label: 'Team B Number',
          type: 'text',
          required: false,
          autoPopulated: true,
          placeholder: 'Select match first',
        },
        {
          id: 'team_b_name',
          label: 'Team B Name',
          type: 'text',
          required: false,
          autoPopulated: true,
          placeholder: 'Select match first',
        },
        {
          id: 'section_header_team_a',
          label: 'TEAM A',
          type: 'section_header',
          column: 'left',
        },
        {
          id: 'team_a_score',
          label: 'Team A Score',
          type: 'number',
          column: 'left',
          required: false,
          min: 0,
          step: 1,
        },
        {
          id: 'team_a_total',
          label: 'TEAM A TOTAL',
          type: 'calculated',
          column: 'left',
          isTotal: true,
          formula: 'team_a_score',
        },
        {
          id: 'section_header_team_b',
          label: 'TEAM B',
          type: 'section_header',
          column: 'right',
        },
        {
          id: 'team_b_score',
          label: 'Team B Score',
          type: 'number',
          column: 'right',
          required: false,
          min: 0,
          step: 1,
        },
        {
          id: 'team_b_total',
          label: 'TEAM B TOTAL',
          type: 'calculated',
          column: 'right',
          isTotal: true,
          formula: 'team_b_score',
        },
      ],
    });
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

  it('requires team initials by default and drops legacy initials fields', () => {
    const schema = buildDoubleSeedingSchema({
      title: 'Initials Sheet',
      eventId: 7,
      templateFields: [
        { id: 'side_a_score', label: 'Side A Score', type: 'number' },
        { id: 'side_a_team_initials', label: 'Team Initials', type: 'text' },
        { id: 'side_b_team_initials', label: 'Team Initials', type: 'text' },
      ],
    });

    const fields = schema.fields as SchemaField[];
    expect(schema.teamInitials).toEqual({ required: true });
    expect(fields.some((f) => f.id === 'team_a_score')).toBe(true);
    expect(fields.some((f) => f.id.endsWith('_team_initials'))).toBe(false);
  });

  it('can turn team initials off', () => {
    const schema = buildDoubleSeedingSchema({
      title: 'No Initials Sheet',
      eventId: 7,
      templateFields: null,
      requireTeamInitials: false,
    });

    expect(schema.teamInitials).toEqual({ required: false });
  });
});
