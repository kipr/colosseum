import { describe, expect, it } from 'vitest';
import {
  getMissingTeamInitialsSlots,
  getRequiredTeamInitialsSlots,
  getSubmissionTeamInitials,
  isLegacyTeamInitialsField,
  isTeamInitialsRequired,
  isValidTeamInitials,
  normalizeTeamInitials,
  validateTeamInitials,
} from '../../src/shared/teamInitials';

describe('normalizeTeamInitials', () => {
  it('trims, strips spaces and periods, and uppercases', () => {
    expect(normalizeTeamInitials('  t.w. ')).toBe('TW');
    expect(normalizeTeamInitials('a b c')).toBe('ABC');
  });

  it('returns an empty string for non-string input', () => {
    expect(normalizeTeamInitials(undefined)).toBe('');
    expect(normalizeTeamInitials(42)).toBe('');
  });
});

describe('isValidTeamInitials', () => {
  it('accepts 1-4 letters, including non-ASCII letters', () => {
    expect(isValidTeamInitials('T')).toBe(true);
    expect(isValidTeamInitials('ABCD')).toBe(true);
    expect(isValidTeamInitials('ÉL')).toBe(true);
  });

  it('rejects empty, too long, or non-letter values', () => {
    expect(isValidTeamInitials('')).toBe(false);
    expect(isValidTeamInitials('ABCDE')).toBe(false);
    expect(isValidTeamInitials('A1')).toBe(false);
    expect(isValidTeamInitials('A-B')).toBe(false);
  });
});

describe('isTeamInitialsRequired', () => {
  it('honors an explicit boolean', () => {
    expect(isTeamInitialsRequired({ requireTeamInitials: true })).toBe(true);
    expect(
      isTeamInitialsRequired({
        requireTeamInitials: false,
        fields: [{ id: 'side_a_team_initials', type: 'text' }],
      }),
    ).toBe(false);
  });

  it('infers the requirement from legacy initials fields', () => {
    expect(
      isTeamInitialsRequired({
        fields: [{ id: 'team_b_team_initials', type: 'text' }],
      }),
    ).toBe(true);
    expect(
      isTeamInitialsRequired({ fields: [{ id: 'score', type: 'number' }] }),
    ).toBe(false);
    expect(isTeamInitialsRequired(null)).toBe(false);
  });
});

describe('isLegacyTeamInitialsField', () => {
  it('matches only the legacy initials ids', () => {
    expect(isLegacyTeamInitialsField({ id: 'side_a_team_initials' })).toBe(
      true,
    );
    expect(isLegacyTeamInitialsField({ id: 'team_b_team_initials' })).toBe(
      true,
    );
    expect(isLegacyTeamInitialsField({ id: 'team_b_score' })).toBe(false);
    expect(isLegacyTeamInitialsField(null)).toBe(false);
  });
});

describe('getRequiredTeamInitialsSlots', () => {
  it('requires the single team for seeding', () => {
    expect(getRequiredTeamInitialsSlots({ scoreType: 'seeding' })).toEqual([
      'team_a',
    ]);
  });

  it('requires both teams for bracket games', () => {
    expect(getRequiredTeamInitialsSlots({ scoreType: 'bracket' })).toEqual([
      'team_a',
      'team_b',
    ]);
  });

  it('requires team B for double seeding only when present', () => {
    expect(
      getRequiredTeamInitialsSlots({
        scoreType: 'double_seeding',
        hasTeamB: false,
      }),
    ).toEqual(['team_a']);
    expect(
      getRequiredTeamInitialsSlots({
        scoreType: 'double_seeding',
        hasTeamB: true,
      }),
    ).toEqual(['team_a', 'team_b']);
  });

  it('requires nothing for unknown score types', () => {
    expect(getRequiredTeamInitialsSlots({ scoreType: null })).toEqual([]);
  });
});

describe('validateTeamInitials', () => {
  it('returns normalized initials when every required slot is valid', () => {
    expect(
      validateTeamInitials({ team_a: 'a.b', team_b: ' cd ' }, [
        'team_a',
        'team_b',
      ]),
    ).toEqual({
      ok: true,
      initials: { team_a: 'AB', team_b: 'CD' },
      errors: {},
    });
  });

  it('reports missing and invalid slots', () => {
    const result = validateTeamInitials({ team_b: 'A1' }, ['team_a', 'team_b']);
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors).sort()).toEqual(['team_a', 'team_b']);
  });

  it('rejects initials for a slot that is not expected', () => {
    const result = validateTeamInitials({ team_a: 'AB', team_b: 'CD' }, [
      'team_a',
    ]);
    expect(result.ok).toBe(false);
    expect(Object.keys(result.errors)).toEqual(['team_b']);
  });

  it('treats non-object input as empty', () => {
    expect(validateTeamInitials('AB', ['team_a']).ok).toBe(false);
    expect(validateTeamInitials(undefined, []).ok).toBe(true);
  });
});

describe('getSubmissionTeamInitials', () => {
  it('prefers the dedicated columns', () => {
    expect(
      getSubmissionTeamInitials({
        team_a_initials: 'AB',
        team_b_initials: null,
        score_data: JSON.stringify({
          team_a_team_initials: { value: 'ZZ' },
          team_b_team_initials: { value: 'cd' },
        }),
      }),
    ).toEqual({ team_a: 'AB', team_b: 'cd' });
  });

  it('reads legacy initials from parsed score data', () => {
    expect(
      getSubmissionTeamInitials({
        score_data: { side_a_team_initials: { value: ' TW ' } },
      }),
    ).toEqual({ team_a: 'TW' });
  });
});

describe('getMissingTeamInitialsSlots', () => {
  it('lists required slots without recorded initials', () => {
    expect(
      getMissingTeamInitialsSlots({
        schema: { requireTeamInitials: true },
        scoreType: 'bracket',
        submission: { team_a_initials: 'AB' },
      }),
    ).toEqual(['team_b']);
  });

  it('is empty when the sheet does not require initials', () => {
    expect(
      getMissingTeamInitialsSlots({
        schema: { fields: [] },
        scoreType: 'bracket',
        submission: {},
      }),
    ).toEqual([]);
  });
});
