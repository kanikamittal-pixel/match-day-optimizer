import { describe, expect, it } from 'vitest';
import fixture from './fixtures/scorecard.json';
import { pointsFromScorecard } from '../backend/services/scorecard';

describe('pointsFromScorecard (real finished T20 scorecard)', () => {
  const pts = pointsFromScorecard((fixture as any).data.scorecard);
  const by = (n: string) => pts.find((p) => p.name === n)!;
  it('scores every player who appears, at least the playing bonus', () => {
    expect(pts.length).toBeGreaterThan(10);
    expect(Math.min(...pts.map((p) => p.points))).toBeGreaterThanOrEqual(-4);
  });
  it('credits a not-out batter, a bowler and a catcher with the current Dream11 table', () => {
    // Tuba Hassan: 12 off 10 (1 four) -> 4 played + 12 runs + 4 boundary = 20, SR 120 = 0;
    // bowled 2 overs at economy 11 -> -2; dots are not in this scorecard.
    expect(by('Tuba Hassan').points).toBe(18);
    expect(by('Nilakshika Silva').points).toBeGreaterThanOrEqual(12); // played 4 + catch 8
    expect(by('Sugandika Kumari').points).toBeGreaterThanOrEqual(34); // played 4 + a wicket (30)
  });
});
