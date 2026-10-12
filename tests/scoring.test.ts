import { describe, expect, it } from 'vitest';
import { emptyAgg, scoreAgg, flattenRules, type Agg } from '../shared/scoring';

const a = (o: Partial<Agg>): Agg => ({ ...emptyAgg(), played: true, ...o });

describe('Dream11 T20 scoring (hand-checked cases)', () => {
  it('batter: 52 off 30 with 5 fours and 2 sixes', () => {
    // 4 played + 52 runs + 5*4 + 2*6 + 8 (fifty, highest milestone only) + SR 173.3 -> +6
    expect(scoreAgg(a({ runs: 52, balls: 30, fours: 5, sixes: 2, out: true }), 'BAT')).toBe(4 + 52 + 20 + 12 + 8 + 6);
  });
  it('a century pays only the century bonus', () => {
    expect(scoreAgg(a({ runs: 100, balls: 100, fours: 0, sixes: 0, out: false }), 'BAT')).toBe(4 + 100 + 16);
  });
  it('duck costs 2 for batters but not bowlers', () => {
    expect(scoreAgg(a({ runs: 0, balls: 3, out: true }), 'BAT')).toBe(4 - 2);
    expect(scoreAgg(a({ runs: 0, balls: 3, out: true }), 'BOWL')).toBe(4);
  });
  it('strike-rate bands include the edge values', () => {
    // bonus = total - 4 (played) - runs; no boundaries or milestones are involved at these scores
    const bonus = (runs: number, balls: number) => scoreAgg(a({ runs, balls }), 'BAT') - 4 - runs;
    expect(bonus(18, 10)).toBe(6); // SR 180
    expect(bonus(17, 10)).toBe(4); // SR 170 exactly -> +4, not +6
    expect(bonus(15, 10)).toBe(2); // SR 150 exactly -> +2
    expect(bonus(13, 10)).toBe(2); // SR 130
    expect(bonus(10, 10)).toBe(0); // SR 100
    expect(bonus(7, 10)).toBe(-2); // SR 70 exactly -> -2
    expect(bonus(6, 10)).toBe(-2); // SR 60
    expect(bonus(5, 10)).toBe(-4); // SR 50
    expect(bonus(4, 10)).toBe(-6); // SR 40
    expect(bonus(9, 9)).toBe(0); // under 10 balls faced: no strike-rate bonus
    expect(scoreAgg(a({ runs: 4, balls: 10 }), 'BOWL') - 4 - 4).toBe(0); // bowlers are exempt
  });
  it('bowler: 4 overs, 3 wickets (one bowled), 2 maidens, 22 runs, 10 dots', () => {
    // 4 + 3*30 + 8 (bowled) + 4 (3-wicket haul) + 2*12 maidens + 10 dots + economy 5.5 -> +4
    expect(scoreAgg(a({ ballsBowled: 24, runsConceded: 22, wickets: 3, lbwBowled: 1, maidens: 2, dots: 10 }), 'BOWL')).toBe(4 + 90 + 8 + 4 + 24 + 10 + 4);
  });
  it('haul bonuses are highest-only and economy needs 2 overs', () => {
    expect(scoreAgg(a({ ballsBowled: 24, runsConceded: 20, wickets: 5 }), 'BOWL')).toBe(4 + 150 + 12 + 4);
    expect(scoreAgg(a({ ballsBowled: 6, runsConceded: 40 }), 'BOWL')).toBe(4); // 1 over: no economy penalty
  });
  it('fielding: 3 catches pays the bonus once, run-outs split direct/indirect', () => {
    expect(scoreAgg(a({ catches: 4 }), 'BAT')).toBe(4 + 32 + 4);
    expect(scoreAgg(a({ stumpings: 1, runOutsDirect: 1, runOutsIndirect: 1 }), 'WK')).toBe(4 + 12 + 12 + 6);
  });
  it('a player who did not play scores nothing', () => {
    expect(scoreAgg({ ...emptyAgg(), runs: 50 }, 'BAT')).toBe(0);
  });
  it('flattened rules carry the headline values', () => {
    const f = flattenRules();
    expect(f.wicket).toBe(30);
    expect(f.boundary_bonus).toBe(4);
    expect(f.six_bonus).toBe(6);
    expect(f.dot_ball).toBe(1);
  });
});
