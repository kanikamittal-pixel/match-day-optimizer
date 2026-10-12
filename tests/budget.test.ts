import { describe, expect, it } from 'vitest';
import { callAllowed, RESERVE } from '../shared/budget';

describe('callAllowed (quota reserve)', () => {
  it('lets routine calls run until the reserve begins', () => {
    expect(callAllowed(0, 95, false)).toBe(true);
    expect(callAllowed(95 - RESERVE - 1, 95, false)).toBe(true);
    expect(callAllowed(95 - RESERVE, 95, false)).toBe(false);
  });
  it('keeps the reserve for essential calls, up to the hard limit', () => {
    expect(callAllowed(95 - RESERVE, 95, true)).toBe(true);
    expect(callAllowed(94, 95, true)).toBe(true);
    expect(callAllowed(95, 95, true)).toBe(false);
  });
});
