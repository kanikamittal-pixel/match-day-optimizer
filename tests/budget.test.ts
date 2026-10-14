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

import { pickKey } from '../shared/budget';
describe('pickKey (backup keys)', () => {
  it('uses the primary key while it has budget', () => expect(pickKey([10, 0], 95, false)).toBe(0));
  it('moves routine calls to the backup key before touching the primary key\'s reserve', () => expect(pickKey([85, 0], 95, false)).toBe(1));
  it('lets essential calls use the primary key\'s reserve', () => expect(pickKey([85, 0], 95, true)).toBe(0));
  it('moves to the backup when the primary is used up', () => expect(pickKey([95, 3], 95, true)).toBe(1));
  it('reports -1 when every key is used up', () => expect(pickKey([95, 95], 95, true)).toBe(-1));
});
