import { describe, expect, it } from 'vitest';
import { plausible } from '../backend/services/webscorecard';

const base = { name: 'X', played: true, runs: 40, balls: 25, fours: 4, sixes: 2, out: true, overs: 4, maidens: 0, runs_conceded: 30, wickets: 2, lbw_or_bowled: 1, catches: 1, stumpings: 0, run_outs: 0 };
describe('plausible (a misread web scorecard row is dropped)', () => {
  it('accepts a normal T20 line', () => expect(plausible(base, 'T20')).toBe(true));
  it('rejects more than 4 overs in a T20, but allows 10 in an ODI', () => {
    expect(plausible({ ...base, overs: 6 }, 'T20')).toBe(false);
    expect(plausible({ ...base, overs: 8 }, 'ODI')).toBe(true);
  });
  it('rejects boundaries that do not fit the balls faced', () => expect(plausible({ ...base, balls: 5, fours: 4, sixes: 3 }, 'T20')).toBe(false));
  it('rejects negative, missing or impossible numbers', () => {
    expect(plausible({ ...base, runs: -1 }, 'T20')).toBe(false);
    expect(plausible({ ...base, wickets: 11 }, 'T20')).toBe(false);
    expect(plausible({ ...base, lbw_or_bowled: 3 }, 'T20')).toBe(false);
    expect(plausible({ ...base, runs: undefined as any }, 'T20')).toBe(false);
  });
});
