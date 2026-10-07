import { describe, it, expect } from 'vitest';
import { nextPowerOfTwo } from '../../src/shared/bracketSize';

describe('nextPowerOfTwo', () => {
  it('returns the minimum size for empty or tiny counts', () => {
    expect(nextPowerOfTwo(0)).toBe(4);
    expect(nextPowerOfTwo(1)).toBe(4);
    expect(nextPowerOfTwo(4)).toBe(4);
  });

  it('rounds up to the next power of two', () => {
    expect(nextPowerOfTwo(5)).toBe(8);
    expect(nextPowerOfTwo(33)).toBe(64);
  });

  it('caps at the largest supported size', () => {
    expect(nextPowerOfTwo(100)).toBe(64);
  });
});
