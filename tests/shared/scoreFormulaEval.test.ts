import { describe, it, expect } from 'vitest';
import { splitRec } from '../../src/shared/scoreFormulaEval';

describe('calculation helpers', () => {
  describe('arithmetic', () => {
    it('handles basic arithmetic', () => {
      expect(
        splitRec(
          '((side_a_starting_cubes * 2) + 1) + (side_a_starting_baskets * 15) * (side_a_starting_botguy * 2 + 1)',
        ),
      ).toStrictEqual({
        type: 'binary',
        op: '*',
        left: {
          type: 'binary',
          op: '+',
          left: {
            type: 'binary',
            op: '+',
            left: {
              type: 'binary',
              op: '*',
              left: { type: 'variable', name: 'side_a_starting_cubes' },
              right: { type: 'number', value: 2 },
            },
            right: { type: 'number', value: 1 },
          },
          right: {
            type: 'binary',
            op: '*',
            left: { type: 'variable', name: 'side_a_starting_baskets' },
            right: { type: 'number', value: 15 },
          },
        },
        right: {
          type: 'binary',
          op: '+',
          left: {
            type: 'binary',
            op: '*',
            left: { type: 'variable', name: 'side_a_starting_botguy' },
            right: { type: 'number', value: 2 },
          },
          right: { type: 'number', value: 1 },
        },
      });
      expect(splitRec('(3 + 4) * 1 * 2')).toStrictEqual({
        type: 'binary',
        op: '*',
        left: {
          type: 'binary',
          op: '*',
          left: {
            type: 'binary',
            op: '+',
            left: { type: 'number', value: 3 },
            right: { type: 'number', value: 4 },
          },
          right: { type: 'number', value: 1 },
        },
        right: { type: 'number', value: 2 },
      });
    });
  });
});
