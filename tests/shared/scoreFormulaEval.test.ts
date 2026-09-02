import { describe, it, expect } from 'vitest';
import { splitRec } from '../../src/shared/scoreFormulaEval';

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

describe('ternary', () => {
  it('handles ternary expressions', () => {
    expect(splitRec('(1 === 1 ? 1 : 2) * 2')).toStrictEqual({
      type: 'binary',
      op: '*',
      left: {
        type: 'conditional',
        condition: {
          type: 'binary',
          op: '===',
          left: { type: 'number', value: 1 },
          right: { type: 'number', value: 1 },
        },
        then: { type: 'number', value: 1 },
        otherwise: { type: 'number', value: 2 },
      },
      right: { type: 'number', value: 2 },
    });
    expect(
      splitRec(
        "(((side_a_starting_cubes * 2) + 1) + (side_a_starting_baskets * 15)) * ((side_a_starting_botguy === '1' ? 2 : 1) + 1)",
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
          type: 'conditional',
          condition: {
            type: 'binary',
            op: '===',
            left: { type: 'variable', name: 'side_a_starting_botguy' },
            right: { type: 'string', value: '1' },
          },
          then: { type: 'number', value: 2 },
          otherwise: { type: 'number', value: 1 },
        },
        right: { type: 'number', value: 1 },
      },
    });
    expect(
      splitRec(
        '((side_a_pb_non_matched_poms * 10) + (side_a_pb_matched_poms * 20) + (side_a_pb_botguy * 150)) * ((side_a_pb_sorted_baskets_mult > 0 || side_a_pb_returned_baskets_mult > 0) ? ((side_a_pb_sorted_baskets_mult > 0 ? side_a_pb_sorted_baskets_mult + 1 : 0) + (side_a_pb_returned_baskets_mult > 0 ? side_a_pb_returned_baskets_mult : 0)) : 1)',
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
            left: { type: 'variable', name: 'side_a_pb_non_matched_poms' },
            right: { type: 'number', value: 10 },
          },
          right: {
            type: 'binary',
            op: '*',
            left: { type: 'variable', name: 'side_a_pb_matched_poms' },
            right: { type: 'number', value: 20 },
          },
        },
        right: {
          type: 'binary',
          op: '*',
          left: { type: 'variable', name: 'side_a_pb_botguy' },
          right: { type: 'number', value: 150 },
        },
      },
      right: {
        type: 'conditional',
        condition: {
          type: 'binary',
          op: '||',
          left: {
            type: 'binary',
            op: '>',
            left: { type: 'variable', name: 'side_a_pb_sorted_baskets_mult' },
            right: { type: 'number', value: 0 },
          },
          right: {
            type: 'binary',
            op: '>',
            left: {
              type: 'variable',
              name: 'side_a_pb_returned_baskets_mult',
            },
            right: { type: 'number', value: 0 },
          },
        },
        then: {
          type: 'binary',
          op: '+',
          left: {
            type: 'conditional',
            condition: {
              type: 'binary',
              op: '>',
              left: {
                type: 'variable',
                name: 'side_a_pb_sorted_baskets_mult',
              },
              right: { type: 'number', value: 0 },
            },
            then: {
              type: 'binary',
              op: '+',
              left: {
                type: 'variable',
                name: 'side_a_pb_sorted_baskets_mult',
              },
              right: { type: 'number', value: 1 },
            },
            otherwise: { type: 'number', value: 0 },
          },
          right: {
            type: 'conditional',
            condition: {
              type: 'binary',
              op: '>',
              left: {
                type: 'variable',
                name: 'side_a_pb_returned_baskets_mult',
              },
              right: { type: 'number', value: 0 },
            },
            then: {
              type: 'variable',
              name: 'side_a_pb_returned_baskets_mult',
            },
            otherwise: { type: 'number', value: 0 },
          },
        },
        otherwise: { type: 'number', value: 1 },
      },
    });
  });
});
