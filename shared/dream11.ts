import type { Rules } from './types';

/**
 * What Dream11 allows. Aryan can make the rules STRICTER than this, never looser, so the app can only ever
 * build a team that Dream11 accepts. Team size and the captain multipliers are fixed.
 */
export const DREAM11 = {
  teamSize: 11,
  captainMult: 2,
  vcMult: 1.5,
  creditCap: { min: 50, max: 100 },
  maxPerTeam: { min: 6, max: 10 }, // two sides must be able to fill 11 places, so at least 6
  roles: { WK: { min: 1, max: 4 }, BAT: { min: 3, max: 6 }, AR: { min: 1, max: 4 }, BOWL: { min: 3, max: 6 } } as Record<string, { min: number; max: number }>,
};

const int = (v: unknown) => { const n = Number(v); return Number.isInteger(n) ? n : NaN; };

/** Checks what Aryan typed in Settings and returns rules Dream11 would accept, or the reason it would not. */
export function checkRules(input: any): { rules: Rules } | { error: string } {
  const cap = Number(input?.credit_cap);
  if (!Number.isFinite(cap) || cap < DREAM11.creditCap.min || cap > DREAM11.creditCap.max) return { error: `Credit cap must be between ${DREAM11.creditCap.min} and ${DREAM11.creditCap.max} (Dream11 allows 100 at most).` };
  const per = int(input?.max_per_team);
  if (!(per >= DREAM11.maxPerTeam.min && per <= DREAM11.maxPerTeam.max)) return { error: `Max from one team must be a whole number from ${DREAM11.maxPerTeam.min} to ${DREAM11.maxPerTeam.max}.` };
  const role_min: Record<string, number> = {}, role_max: Record<string, number> = {};
  for (const [role, lim] of Object.entries(DREAM11.roles)) {
    const lo = int(input?.role_min?.[role]), hi = int(input?.role_max?.[role]);
    if (!(lo >= lim.min && lo <= lim.max)) return { error: `${role} minimum must be from ${lim.min} to ${lim.max}.` };
    if (!(hi >= lim.min && hi <= lim.max)) return { error: `${role} maximum must be from ${lim.min} to ${lim.max}.` };
    if (lo > hi) return { error: `${role}: the minimum is above the maximum.` };
    role_min[role] = lo; role_max[role] = hi;
  }
  const minSum = Object.values(role_min).reduce((s, x) => s + x, 0), maxSum = Object.values(role_max).reduce((s, x) => s + x, 0);
  if (minSum > DREAM11.teamSize || maxSum < DREAM11.teamSize) return { error: `The role limits must allow a team of ${DREAM11.teamSize}.` };
  return { rules: { credit_cap: cap, team_size: DREAM11.teamSize, max_per_team: per, captain_mult: DREAM11.captainMult, vc_mult: DREAM11.vcMult, role_min: role_min as Rules['role_min'], role_max: role_max as Rules['role_max'] } };
}
