import { describe, expect, it } from 'vitest';
import { scoreBotballStartBoxCubes } from '../../src/client/scoring/botballStartBoxCubes';

describe('scoreBotballStartBoxCubes', () => {
  it('scores each cube type with pallet doubling when selected', () => {
    expect(
      scoreBotballStartBoxCubes([
        { cube_type: 'small', quantity: 2 },
        { cube_type: 'large_red_green', quantity: 1, on_pallet: true },
        { cube_type: 'large_brown', quantity: 1, on_pallet: '1' },
      ]),
    ).toEqual({
      subtotal: 130,
      rows: [
        { subtotal: 10 },
        { subtotal: 40 },
        { subtotal: 80 },
      ],
    });
  });

  it('coerces quantities and ignores blank or invalid rows', () => {
    expect(
      scoreBotballStartBoxCubes([
        { cube_type: 'small', quantity: '3', on_pallet: 'true' },
        { cube_type: 'large_red_green', quantity: 2.9 },
        { cube_type: 'large_brown', quantity: -1, on_pallet: true },
        { cube_type: 'large_brown', quantity: 'bad', on_pallet: true },
        { cube_type: '', quantity: 5, on_pallet: true },
        { quantity: 5, on_pallet: true },
      ]),
    ).toEqual({
      subtotal: 70,
      rows: [{ subtotal: 30 }, { subtotal: 40 }],
    });
  });
});
