import { describe, it, expect } from 'vitest';
import {
  awardWeight,
  compareByAwardLoad,
  isAwardType,
  type TeamAwardCounts,
} from '../../src/shared/awards';

function team(
  partial: Partial<TeamAwardCounts> & Pick<TeamAwardCounts, 'team_id' | 'team_number'>,
): TeamAwardCounts {
  return {
    team_name: `Team ${partial.team_number}`,
    display_name: null,
    certificate_count: 0,
    trophy_count: 0,
    ...partial,
  };
}

describe('shared awards helpers', () => {
  describe('isAwardType', () => {
    it('accepts certificate and trophy', () => {
      expect(isAwardType('certificate')).toBe(true);
      expect(isAwardType('trophy')).toBe(true);
    });

    it('rejects other values', () => {
      expect(isAwardType('medal')).toBe(false);
      expect(isAwardType('')).toBe(false);
      expect(isAwardType(null)).toBe(false);
    });
  });

  describe('awardWeight', () => {
    it('counts trophies as twice certificates', () => {
      expect(
        awardWeight({ certificate_count: 1, trophy_count: 0 }),
      ).toBe(1);
      expect(awardWeight({ certificate_count: 0, trophy_count: 1 })).toBe(2);
      expect(awardWeight({ certificate_count: 2, trophy_count: 1 })).toBe(4);
    });
  });

  describe('compareByAwardLoad', () => {
    it('sorts least weighted first', () => {
      const a = team({ team_id: 1, team_number: 10, trophy_count: 1 });
      const b = team({ team_id: 2, team_number: 20, certificate_count: 1 });
      expect(compareByAwardLoad(b, a)).toBeLessThan(0);
      expect(compareByAwardLoad(a, b)).toBeGreaterThan(0);
    });

    it('tie-breaks on team_number ascending', () => {
      const a = team({ team_id: 1, team_number: 30, certificate_count: 1 });
      const b = team({ team_id: 2, team_number: 10, certificate_count: 1 });
      expect(compareByAwardLoad(b, a)).toBeLessThan(0);
    });
  });
});
