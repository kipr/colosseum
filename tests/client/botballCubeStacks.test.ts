import { describe, expect, it } from 'vitest';
import { scoreBotballCubeStacks } from '../../src/client/scoring/botballCubeStacks';

describe('scoreBotballCubeStacks', () => {
  const values = { sortedValue: 30, unsortedValue: 10 };

  it('one large green cube counts as four unsorted cube equivalents', () => {
    expect(
      scoreBotballCubeStacks([{ has_pallet: true, large_green: 1 }], values),
    ).toMatchObject({
      sortedEquivalent: 0,
      unsortedEquivalent: 4,
      subtotal: 40,
      rows: [{ sorted: false, sortedColor: null, equivalent: 4, subtotal: 40 }],
    });
  });

  it('one small red cube on a pallet counts as one unsorted cube equivalent', () => {
    expect(
      scoreBotballCubeStacks([{ has_pallet: true, small_red: 1 }], values),
    ).toMatchObject({
      sortedEquivalent: 0,
      unsortedEquivalent: 1,
      subtotal: 10,
      rows: [{ sorted: false, sortedColor: null, equivalent: 1, subtotal: 10 }],
    });
  });

  it('one large brown cube counts as eight unsorted cube equivalents', () => {
    expect(
      scoreBotballCubeStacks([{ has_pallet: true, large_brown: 1 }], values),
    ).toMatchObject({
      sortedEquivalent: 0,
      unsortedEquivalent: 8,
      subtotal: 80,
      rows: [{ sorted: false, sortedColor: null, equivalent: 8, subtotal: 80 }],
    });
  });

  it('one small red plus one small green counts as two unsorted cube equivalents', () => {
    expect(
      scoreBotballCubeStacks(
        [{ has_pallet: true, small_red: 1, small_green: 1 }],
        values,
      ),
    ).toMatchObject({
      sortedEquivalent: 0,
      unsortedEquivalent: 2,
      subtotal: 20,
      rows: [{ sorted: false, sortedColor: null, equivalent: 2, subtotal: 20 }],
    });
  });

  it('one small red plus one small green plus one large brown counts as ten unsorted cube equivalents', () => {
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
      rows: [
        { sorted: false, sortedColor: null, equivalent: 10, subtotal: 100 },
      ],
    });
  });

  it('one large green plus three small green counts as seven sorted green cube equivalents', () => {
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
  });

  it('one large brown plus two small red counts as ten sorted red cube equivalents', () => {
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
  });

  it('one large green plus one large brown counts as twelve sorted green cube equivalents', () => {
    expect(
      scoreBotballCubeStacks(
        [{ has_pallet: true, large_green: 1, large_brown: 1 }],
        values,
      ),
    ).toMatchObject({
      sortedEquivalent: 12,
      unsortedEquivalent: 0,
      subtotal: 360,
      rows: [
        { sorted: true, sortedColor: 'green', equivalent: 12, subtotal: 360 },
      ],
    });
  });

  it('one small yellow plus one large brown counts as nine sorted yellow cube equivalents', () => {
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

  it('one small yellow plus one small red counts as two unsorted cube equivalents', () => {
    expect(
      scoreBotballCubeStacks(
        [{ has_pallet: true, small_yellow: 1, small_red: 1 }],
        values,
      ),
    ).toMatchObject({
      sortedEquivalent: 0,
      unsortedEquivalent: 2,
      subtotal: 20,
      rows: [{ sorted: false, sortedColor: null, equivalent: 2, subtotal: 20 }],
    });
  });

  it('multiple stack rows aggregate sorted equivalents, unsorted equivalents, and subtotal correctly', () => {
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
