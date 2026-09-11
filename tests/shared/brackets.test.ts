import { describe, expect, it } from 'vitest';
import { nextPowerOfTwo } from '../../src/shared/brackets';

describe('nextPowerOfTwo', () => {
  it('returns 4 for empty or non-positive counts', () => {
    expect(nextPowerOfTwo(0)).toBe(4);
    expect(nextPowerOfTwo(-3)).toBe(4);
  });

  it('rounds up to the next power of two', () => {
    expect(nextPowerOfTwo(1)).toBe(4);
    expect(nextPowerOfTwo(3)).toBe(4);
    expect(nextPowerOfTwo(4)).toBe(4);
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(8)).toBe(8);
    expect(nextPowerOfTwo(9)).toBe(16);
  });

  it('clamps to a maximum of 64', () => {
    expect(nextPowerOfTwo(64)).toBe(64);
    expect(nextPowerOfTwo(65)).toBe(64);
  });
});
