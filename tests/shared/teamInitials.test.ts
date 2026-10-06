import { describe, expect, it } from 'vitest';
import {
  isLegacyInitialsField,
  isValidTeamInitials,
  normalizeTeamInitials,
  requiresTeamInitials,
  stripLegacyInitialsFields,
} from '../../src/shared/teamInitials';
import {
  checkTeamInitials,
  expectedTwoSidedInitials,
} from '../../src/server/services/teamInitials';

describe('normalizeTeamInitials', () => {
  it('uppercases and strips spaces, periods, and hyphens', () => {
    expect(normalizeTeamInitials(' j.d. ')).toBe('JD');
    expect(normalizeTeamInitials('a b-c')).toBe('ABC');
  });

  it('keeps accented letters', () => {
    expect(normalizeTeamInitials('é.ñ')).toBe('ÉÑ');
  });

  it('returns an empty string for non-strings', () => {
    expect(normalizeTeamInitials(undefined)).toBe('');
    expect(normalizeTeamInitials(42)).toBe('');
  });
});

describe('isValidTeamInitials', () => {
  it('accepts 2 to 5 letters', () => {
    expect(isValidTeamInitials('JD')).toBe(true);
    expect(isValidTeamInitials('ABCDE')).toBe(true);
    expect(isValidTeamInitials('ÉÑ')).toBe(true);
  });

  it('rejects too few or too many letters, digits, and symbols', () => {
    expect(isValidTeamInitials('')).toBe(false);
    expect(isValidTeamInitials('J')).toBe(false);
    expect(isValidTeamInitials('ABCDEF')).toBe(false);
    expect(isValidTeamInitials('J1')).toBe(false);
    expect(isValidTeamInitials('J!')).toBe(false);
  });
});

describe('requiresTeamInitials', () => {
  const legacyField = { id: 'team_a_team_initials', type: 'text' };

  it('follows an explicit setting over legacy fields', () => {
    expect(
      requiresTeamInitials({ teamInitials: { required: true }, fields: [] }),
    ).toBe(true);
    expect(
      requiresTeamInitials({
        teamInitials: { required: false },
        fields: [legacyField],
      }),
    ).toBe(false);
  });

  it('turns on for sheets built from templates with legacy initials fields', () => {
    expect(requiresTeamInitials({ fields: [legacyField] })).toBe(true);
    expect(
      requiresTeamInitials({
        fields: [{ id: 'side_a_team_initials', type: 'text' }],
      }),
    ).toBe(true);
  });

  it('stays off without a setting or legacy fields', () => {
    expect(requiresTeamInitials({ fields: [] })).toBe(false);
    expect(requiresTeamInitials([])).toBe(false);
    expect(requiresTeamInitials(null)).toBe(false);
  });
});

describe('stripLegacyInitialsFields', () => {
  it('removes only the legacy initials fields', () => {
    const fields = [
      { id: 'side_a_score', type: 'number' },
      { id: 'side_a_team_initials', type: 'text' },
      { id: 'side_b_team_initials', type: 'text' },
      { id: 'team_a_team_initials', type: 'text' },
      { id: 'team_b_team_initials', type: 'text' },
      { id: 'notes', type: 'text' },
    ];

    expect(stripLegacyInitialsFields(fields).map((f) => f.id)).toEqual([
      'side_a_score',
      'notes',
    ]);
    expect(isLegacyInitialsField({ id: 'notes' })).toBe(false);
  });
});

describe('checkTeamInitials', () => {
  const describeTeam = (teamId: number) => `team #${teamId}`;

  it('maps team1/team2 to sides A/B and skips missing teams', () => {
    expect(expectedTwoSidedInitials(1, 2)).toEqual([
      { side: 'team_a', teamId: 1 },
      { side: 'team_b', teamId: 2 },
    ]);
    expect(expectedTwoSidedInitials(1, null)).toEqual([
      { side: 'team_a', teamId: 1 },
    ]);
  });

  it('returns normalized initials for every expected team', () => {
    expect(
      checkTeamInitials(
        expectedTwoSidedInitials(1, 2),
        [
          { side: 'team_b', initials: 'c.d' },
          { side: 'team_a', initials: 'ab' },
        ],
        describeTeam,
      ),
    ).toEqual({
      ok: true,
      entries: [
        { side: 'team_a', teamId: 1, initials: 'AB' },
        { side: 'team_b', teamId: 2, initials: 'CD' },
      ],
    });
  });

  it('rejects a payload that is not an array', () => {
    expect(
      checkTeamInitials([{ side: 'team', teamId: 1 }], 'AB', describeTeam),
    ).toEqual({ ok: false, error: 'teamInitials must be an array' });
  });

  it('names the team that still has to initial', () => {
    expect(
      checkTeamInitials(
        expectedTwoSidedInitials(1, 2),
        [{ side: 'team_a', initials: 'AB' }],
        describeTeam,
      ),
    ).toEqual({
      ok: false,
      error: 'Team initials are required for team #2',
    });
  });
});
