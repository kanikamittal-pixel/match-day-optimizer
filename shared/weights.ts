import type { Rules } from '@/shared/types';

export const DEFAULT_RULES: Rules = {
  credit_cap: 100,
  team_size: 11,
  role_min: { WK: 1, BAT: 3, AR: 1, BOWL: 3 },
  role_max: { WK: 4, BAT: 6, AR: 4, BOWL: 6 },
  max_per_team: 10,
  captain_mult: 2,
  vc_mult: 1.5,
};

/**
 * Starting scoring weights (Dream11 T20 style). Keys beginning `adj_` are situational
 * multipliers the learning loop can tune; everything else is points per event.
 * Version 1 is seeded on first run; later versions only ever come from Aryan's approvals.
 */
export const DEFAULT_WEIGHTS: Record<string, number> = {
  run: 1,
  boundary_bonus: 1,
  six_bonus: 2,
  bonus_25: 4,
  bonus_50: 8,
  bonus_100: 16,
  duck: -2,
  wicket: 25,
  lbw_bowled_bonus: 8,
  bonus_3_wkts: 4,
  bonus_5_wkts: 16,
  maiden: 12,
  catch: 8,
  stumping: 12,
  run_out_direct: 12,
  in_xi: 4,
  adj_openers_slow_pitch: 1,
  adj_spinners_turning_pitch: 1,
  adj_pace_seaming_pitch: 1,
  adj_death_bowlers: 1,
  adj_allrounders: 1,
  adj_wicketkeepers: 1,
  adj_top_order_batting_pitch: 1,
};
