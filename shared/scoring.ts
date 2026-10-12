/**
 * Dream11 T20 fantasy scoring, applied to one player's match aggregates.
 * Values follow the "current" T20 table researched in the Predict-11 repo (RULES.md), which that repo
 * checked against 40 published IPL 2026 totals. We have NOT independently verified them: confirm against
 * the points-system page in the Dream11 app. All values live in T20_CURRENT so a change is one edit.
 */
export type ScoreRole = 'WK' | 'BAT' | 'AR' | 'BOWL';

export interface Agg {
  played: boolean;
  runs: number;
  balls: number; // balls faced (wides excluded, no-balls included)
  fours: number;
  sixes: number;
  out: boolean;
  ballsBowled: number; // legal balls
  runsConceded: number; // batter runs + wides + no-ball extras (byes / leg-byes excluded)
  dots: number;
  maidens: number;
  wickets: number; // excluding run-outs
  lbwBowled: number;
  catches: number;
  stumpings: number;
  runOutsDirect: number;
  runOutsIndirect: number;
}

export const emptyAgg = (): Agg => ({
  played: false, runs: 0, balls: 0, fours: 0, sixes: 0, out: false,
  ballsBowled: 0, runsConceded: 0, dots: 0, maidens: 0, wickets: 0, lbwBowled: 0,
  catches: 0, stumpings: 0, runOutsDirect: 0, runOutsIndirect: 0,
});

export const T20_CURRENT = {
  played: 4,
  run: 1,
  four: 4,
  six: 6,
  milestones: [[100, 16], [75, 12], [50, 8], [25, 4]] as [number, number][], // highest only
  duck: -2, // batters, wicket-keepers and all-rounders only
  srMinBalls: 10,
  dot: 1,
  wicket: 30,
  lbwBowledBonus: 8,
  hauls: [[5, 12], [4, 8], [3, 4]] as [number, number][], // highest only
  maiden: 12,
  econMinBalls: 12,
  catch: 8,
  threeCatchBonus: 4, // once
  stumping: 12,
  runOutDirect: 12,
  runOutIndirect: 6,
};
export type Rules = typeof T20_CURRENT;

/** Flat key/value form of the rules, used to seed the versioned scoring-weights table. */
export function flattenRules(r: Rules = T20_CURRENT): Record<string, number> {
  return {
    in_xi: r.played, run: r.run, boundary_bonus: r.four, six_bonus: r.six,
    bonus_25: 4, bonus_50: 8, bonus_75: 12, bonus_100: 16, duck: r.duck,
    sr_over_170: 6, sr_150_170: 4, sr_130_150: 2, sr_60_70: -2, sr_50_60: -4, sr_under_50: -6,
    dot_ball: r.dot, wicket: r.wicket, lbw_bowled_bonus: r.lbwBowledBonus,
    bonus_3_wkts: 4, bonus_4_wkts: 8, bonus_5_wkts: 12, maiden: r.maiden,
    econ_under_5: 6, econ_5_6: 4, econ_6_7: 2, econ_10_11: -2, econ_11_12: -4, econ_over_12: -6,
    catch: r.catch, bonus_3_catches: r.threeCatchBonus, stumping: r.stumping,
    run_out_direct: r.runOutDirect, run_out_indirect: r.runOutIndirect,
    adj_openers_slow_pitch: 1, adj_spinners_turning_pitch: 1, adj_pace_seaming_pitch: 1,
    adj_death_bowlers: 1, adj_allrounders: 1, adj_wicketkeepers: 1, adj_top_order_batting_pitch: 1,
  };
}

function srBonus(runs: number, balls: number): number {
  const sr = (100 * runs) / balls;
  if (sr > 170) return 6;
  if (sr > 150) return 4;
  if (sr >= 130) return 2;
  if (sr >= 60 && sr <= 70) return -2;
  if (sr >= 50 && sr < 60) return -4;
  if (sr < 50) return -6;
  return 0;
}

function econBonus(conceded: number, legalBalls: number): number {
  const eco = (6 * conceded) / legalBalls;
  if (eco < 5) return 6;
  if (eco < 6) return 4;
  if (eco <= 7) return 2;
  if (eco >= 10 && eco <= 11) return -2;
  if (eco > 11 && eco <= 12) return -4;
  if (eco > 12) return -6;
  return 0;
}

/** Role is needed for the bowler exemptions (no duck, no strike-rate bonus). Unknown role = treated as a batter. */
export function scoreAgg(a: Agg, role?: ScoreRole, r: Rules = T20_CURRENT): number {
  if (!a.played) return 0;
  let p = r.played;
  // batting
  p += a.runs * r.run + a.fours * r.four + a.sixes * r.six;
  const ms = r.milestones.find(([n]) => a.runs >= n);
  if (ms) p += ms[1];
  if (a.out && a.runs === 0 && role !== 'BOWL') p += r.duck;
  if (a.balls >= r.srMinBalls && role !== 'BOWL') p += srBonus(a.runs, a.balls);
  // bowling
  p += a.dots * r.dot + a.wickets * r.wicket + a.lbwBowled * r.lbwBowledBonus + a.maidens * r.maiden;
  const haul = r.hauls.find(([n]) => a.wickets >= n);
  if (haul) p += haul[1];
  if (a.ballsBowled >= r.econMinBalls) p += econBonus(a.runsConceded, a.ballsBowled);
  // fielding
  p += a.catches * r.catch + (a.catches >= 3 ? r.threeCatchBonus : 0);
  p += a.stumpings * r.stumping + a.runOutsDirect * r.runOutDirect + a.runOutsIndirect * r.runOutIndirect;
  return p;
}
