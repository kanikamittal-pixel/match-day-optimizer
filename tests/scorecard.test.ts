import { describe, expect, it } from 'vitest';
import fixture from './fixtures/scorecard.json';
import { pointsFromScorecard } from '../backend/services/scorecard';
import { DEFAULT_WEIGHTS } from '../shared/weights';

describe('pointsFromScorecard (real finished T20 scorecard)', () => {
  const pts = pointsFromScorecard((fixture as any).data.scorecard, DEFAULT_WEIGHTS, 'T20');
  const by = (n: string) => pts.find((p) => p.name === n)!;
  it('scores every player who appears, at least the playing bonus', () => {
    expect(pts.length).toBeGreaterThan(10);
    expect(Math.min(...pts.map((p) => p.points))).toBeGreaterThanOrEqual(-4);
  });
  it('credits a not-out batter and a catcher correctly', () => {
    // Tuba Hassan: 12 runs + 1 four + 4 (played) = 17, minus 4 for bowling 2 overs at economy 11 = 13
    expect(by('Tuba Hassan').points).toBe(13);
    // Nilakshika Silva took a catch (+8) on top of the playing bonus
    expect(by('Nilakshika Silva').points).toBeGreaterThanOrEqual(12);
  });
  it('gives the bowler wicket points', () => {
    expect(by('Sugandika Kumari').points).toBeGreaterThanOrEqual(25);
  });
});
