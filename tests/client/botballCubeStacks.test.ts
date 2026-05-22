import { describe, expect, it } from 'vitest';
import { scoreBotballCubeStacks } from '../../src/client/scoring/botballCubeStacks';

describe('scoreBotballCubeStacks', () => {
  const values = { sortedValue: 30, unsortedValue: 10 };

  it('scores individual unsorted stacks by cube equivalents', () => {
    expect(
      scoreBotballCubeStacks([{ has_pallet: true, large_green: 1 }], values),
    ).toMatchObject({
      sortedEquivalent: 0,
      unsortedEquivalent: 4,
      subtotal: 40,
      rows: [{ sorted: false, sortedColor: null, equivalent: 4, subtotal: 40 }],
    });

    expect(scoreBotballCubeStacks([{ large_green: 1 }], values)).toMatchObject({
      sortedEquivalent: 0,
      unsortedEquivalent: 4,
      subtotal: 40,
      rows: [{ sorted: false, sortedColor: null, equivalent: 4, subtotal: 40 }],
    });

    expect(
      scoreBotballCubeStacks([{ has_pallet: true, large_brown: 1 }], values),
    ).toMatchObject({
      sortedEquivalent: 0,
      unsortedEquivalent: 8,
      subtotal: 80,
      rows: [{ sorted: false, sortedColor: null, equivalent: 8, subtotal: 80 }],
    });
  });

  it('does not sort lone physical objects even when they are on a pallet', () => {
    expect(
      scoreBotballCubeStacks([{ has_pallet: true, small_red: 1 }], values),
    ).toMatchObject({
      sortedEquivalent: 0,
      unsortedEquivalent: 1,
      subtotal: 10,
      rows: [{ sorted: false, sortedColor: null, equivalent: 1, subtotal: 10 }],
    });

    expect(
      scoreBotballCubeStacks([{ has_pallet: true, large_red: 1 }], values),
    ).toMatchObject({
      sortedEquivalent: 0,
      unsortedEquivalent: 4,
      subtotal: 40,
      rows: [{ sorted: false, sortedColor: null, equivalent: 4, subtotal: 40 }],
    });
  });

  it('treats mixed sortable colors as fully unsorted', () => {
    expect(
      scoreBotballCubeStacks(
        [{ has_pallet: true, small_red: 1, small_green: 1 }],
        values,
      ),
    ).toMatchObject({
      sortedEquivalent: 0,
      unsortedEquivalent: 2,
      subtotal: 20,
    });

    expect(
      scoreBotballCubeStacks(
        [
          {
            has_pallet: true,
            small_red: 1,
            small_green: 1,
            large_brown: 1,
          },
        ],
        values,
      ),
    ).toMatchObject({
      sortedEquivalent: 0,
      unsortedEquivalent: 10,
      subtotal: 100,
    });

    expect(
      scoreBotballCubeStacks(
        [{ has_pallet: true, small_yellow: 1, small_red: 1 }],
        values,
      ),
    ).toMatchObject({
      sortedEquivalent: 0,
      unsortedEquivalent: 2,
      subtotal: 20,
    });
  });

  it('sorts exactly one sortable color plus optional brown', () => {
    expect(
      scoreBotballCubeStacks(
        [{ has_pallet: true, large_green: 1, small_green: 3 }],
        values,
      ),
    ).toMatchObject({
      sortedEquivalent: 7,
      unsortedEquivalent: 0,
      subtotal: 210,
      rows: [
        { sorted: true, sortedColor: 'green', equivalent: 7, subtotal: 210 },
      ],
    });

    expect(
      scoreBotballCubeStacks(
        [{ has_pallet: true, large_brown: 1, small_red: 2 }],
        values,
      ),
    ).toMatchObject({
      sortedEquivalent: 10,
      unsortedEquivalent: 0,
      subtotal: 300,
      rows: [
        { sorted: true, sortedColor: 'red', equivalent: 10, subtotal: 300 },
      ],
    });

    expect(
      scoreBotballCubeStacks(
        [{ has_pallet: true, large_green: 1, large_brown: 1 }],
        values,
      ),
    ).toMatchObject({
      sortedEquivalent: 12,
      unsortedEquivalent: 0,
      subtotal: 360,
    });

    expect(
      scoreBotballCubeStacks(
        [{ has_pallet: true, small_yellow: 1, large_brown: 1 }],
        values,
      ),
    ).toMatchObject({
      sortedEquivalent: 9,
      unsortedEquivalent: 0,
      subtotal: 270,
      rows: [
        { sorted: true, sortedColor: 'yellow', equivalent: 9, subtotal: 270 },
      ],
    });
  });

  it('aggregates rows and ignores blank or invalid counts', () => {
    expect(
      scoreBotballCubeStacks(
        [
          { has_pallet: true, small_red: '2', large_brown: '1' },
          { has_pallet: false, large_green: 1 },
          { has_pallet: true, small_red: '', large_brown: -1 },
          { has_pallet: true, small_green: 'bad', small_yellow: 'Infinity' },
        ],
        values,
      ),
    ).toEqual({
      sortedEquivalent: 10,
      unsortedEquivalent: 4,
      subtotal: 340,
      rows: [
        { sorted: true, sortedColor: 'red', equivalent: 10, subtotal: 300 },
        { sorted: false, sortedColor: null, equivalent: 4, subtotal: 40 },
      ],
    });
  });
});
