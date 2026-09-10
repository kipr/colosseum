import { describe, expect, it } from 'vitest';
import {
  TEAM_A_INITIALS_ID,
  TEAM_B_INITIALS_ID,
  SEEDING_TEAM_INITIALS_ID,
  buildTeamInitialsScoreEntries,
  getMissingTeamInitialsError,
  getRequiredTeamInitialsSlots,
  inferEventScoreType,
  isEventScopedScoresheet,
  isTeamInitialsFieldId,
  readTeamInitialsValue,
  shouldRequireTeamInitials,
  stripTeamInitialsFields,
} from '../../src/shared/teamInitials';
import fallFields from '../../templates/botball-2026-fall-scoring-fields.json';
import standardFields from '../../templates/botball-2026-scoring-fields.json';
import gcerFields from '../../templates/botball-gcer-2026-scoring-fields.json';

describe('teamInitials', () => {
  it('identifies both canonical and legacy initials field ids', () => {
    expect(isTeamInitialsFieldId(SEEDING_TEAM_INITIALS_ID)).toBe(true);
    expect(isTeamInitialsFieldId(TEAM_A_INITIALS_ID)).toBe(true);
    expect(isTeamInitialsFieldId(TEAM_B_INITIALS_ID)).toBe(true);
    expect(isTeamInitialsFieldId('side_b_team_initials')).toBe(true);
    expect(isTeamInitialsFieldId('team_a_score')).toBe(false);
    expect(isTeamInitialsFieldId(undefined)).toBe(false);
  });

  it('strips initials fields from template arrays', () => {
    expect(
      stripTeamInitialsFields([
        { id: 'side_a_score', type: 'number' },
        { id: SEEDING_TEAM_INITIALS_ID, type: 'text' },
        { id: TEAM_B_INITIALS_ID, type: 'text' },
      ]).map((field) => field.id),
    ).toEqual(['side_a_score']);
  });

  it('requires initials for event-scoped sheets and opt-in portable sheets', () => {
    expect(
      isEventScopedScoresheet({ eventId: 3, scoreDestination: 'db' }),
    ).toBe(true);
    expect(
      shouldRequireTeamInitials({ eventId: 3, scoreDestination: 'db' }),
    ).toBe(true);
    expect(shouldRequireTeamInitials({ requireTeamInitials: true })).toBe(true);
    expect(shouldRequireTeamInitials({ layout: 'two-column' })).toBe(false);
    expect(
      shouldRequireTeamInitials({ eventId: 3, scoreDestination: 'sheets' }),
    ).toBe(false);
  });

  it('infers score type from schema chrome', () => {
    expect(
      inferEventScoreType({
        eventId: 1,
        scoreDestination: 'db',
        mode: 'head-to-head',
      }),
    ).toBe('bracket');
    expect(
      inferEventScoreType({
        eventId: 1,
        scoreDestination: 'db',
        scoreKind: 'double_seeding',
      }),
    ).toBe('double_seeding');
    expect(inferEventScoreType({ eventId: 1, scoreDestination: 'db' })).toBe(
      'seeding',
    );
    expect(inferEventScoreType({ mode: 'head-to-head' })).toBeNull();
  });

  it('returns one slot for seeding and solo double seeding, two for pair matches', () => {
    expect(getRequiredTeamInitialsSlots({ scoreType: 'seeding' })).toEqual([
      { id: SEEDING_TEAM_INITIALS_ID, label: 'Team Initials' },
    ]);
    expect(
      getRequiredTeamInitialsSlots({
        scoreType: 'double_seeding',
        hasTeamB: false,
      }),
    ).toEqual([{ id: TEAM_A_INITIALS_ID, label: 'Team A Initials' }]);
    expect(getRequiredTeamInitialsSlots({ scoreType: 'bracket' })).toHaveLength(
      2,
    );
  });

  it('accepts wrapped score_data values and legacy aliases', () => {
    expect(
      readTeamInitialsValue(
        { [TEAM_A_INITIALS_ID]: { value: '  AB  ', type: 'text' } },
        TEAM_A_INITIALS_ID,
      ),
    ).toBe('AB');
    expect(
      readTeamInitialsValue(
        { [SEEDING_TEAM_INITIALS_ID]: { value: 'XY', type: 'text' } },
        TEAM_A_INITIALS_ID,
      ),
    ).toBe('XY');
  });

  it('reports missing initials even for DQ-style empty score_data', () => {
    const slots = getRequiredTeamInitialsSlots({ scoreType: 'bracket' });
    expect(getMissingTeamInitialsError({}, slots)).toBe(
      'Team initials are required for each participating team',
    );
    expect(
      getMissingTeamInitialsError(
        { [TEAM_A_INITIALS_ID]: { value: 'AA', type: 'text' } },
        slots,
      ),
    ).toBe('Team B Initials are required');
    expect(
      getMissingTeamInitialsError(
        {
          [TEAM_A_INITIALS_ID]: { value: 'AA', type: 'text' },
          [TEAM_B_INITIALS_ID]: { value: 'BB', type: 'text' },
        },
        slots,
      ),
    ).toBeNull();
  });

  it('builds score_data entries for the active slots only', () => {
    const slots = getRequiredTeamInitialsSlots({
      scoreType: 'double_seeding',
      hasTeamB: false,
    });
    expect(
      buildTeamInitialsScoreEntries(
        { [TEAM_A_INITIALS_ID]: ' aa ', [TEAM_B_INITIALS_ID]: 'bb' },
        slots,
      ),
    ).toEqual({
      [TEAM_A_INITIALS_ID]: {
        label: 'Team A Initials',
        value: 'aa',
        type: 'text',
      },
    });
  });
});

describe('official scoring field templates', () => {
  it.each([
    ['standard', standardFields],
    ['GCER', gcerFields],
    ['fall', fallFields],
  ])('does not include initials fields in the %s template', (_name, fields) => {
    expect(
      (fields as Array<{ id?: string }>).some((field) =>
        isTeamInitialsFieldId(field.id),
      ),
    ).toBe(false);
  });
});
