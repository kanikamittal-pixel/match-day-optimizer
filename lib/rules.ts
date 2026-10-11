import { ROLES, type Candidate, type Role, type Rules } from './types';

export interface Violation {
  code: 'size' | 'duplicate' | 'credits' | 'role_min' | 'role_max' | 'team_max' | 'ineligible' | 'missing_data';
  message: string;
}

const tenth = (n: number) => Math.round(n * 10);

export function creditsUsed(team: Candidate[]): number {
  return tenth(team.reduce((s, p) => s + p.credit, 0)) / 10;
}

/** Deterministic Dream11 validity check. An empty result means the team is submittable as-is. */
export function validateTeam(team: Candidate[], rules: Rules, eligible?: Set<string>): Violation[] {
  const v: Violation[] = [];
  if (team.length !== rules.team_size) v.push({ code: 'size', message: `Need exactly ${rules.team_size} players, have ${team.length}.` });
  if (new Set(team.map((p) => p.key)).size !== team.length) v.push({ code: 'duplicate', message: 'A player appears twice.' });
  if (team.some((p) => !Number.isFinite(p.credit))) v.push({ code: 'missing_data', message: 'A player has no credit value.' });
  const used = creditsUsed(team);
  if (used > rules.credit_cap) v.push({ code: 'credits', message: `${used} credits used, cap is ${rules.credit_cap}.` });
  for (const r of ROLES) {
    const n = team.filter((p) => p.role === r).length;
    if (n < rules.role_min[r]) v.push({ code: 'role_min', message: `Need at least ${rules.role_min[r]} ${r}, have ${n}.` });
    if (n > rules.role_max[r]) v.push({ code: 'role_max', message: `At most ${rules.role_max[r]} ${r} allowed, have ${n}.` });
  }
  const byTeam = new Map<string, number>();
  for (const p of team) byTeam.set(p.team, (byTeam.get(p.team) ?? 0) + 1);
  for (const [t, n] of byTeam) if (n > rules.max_per_team) v.push({ code: 'team_max', message: `${n} players from ${t}, max is ${rules.max_per_team}.` });
  if (eligible) for (const p of team) if (!eligible.has(p.key)) v.push({ code: 'ineligible', message: `${p.name} is not in the confirmed XI or impact subs.` });
  return v;
}

export interface BuildResult {
  team: Candidate[];
  totalXp: number;
  credits: number;
}

/**
 * Exact best-XI search (branch and bound) over the eligible pool. No AI involved.
 * `pinned` players are forced into the team. Returns null if no valid XI exists.
 */
export function buildBestXI(pool: Candidate[], rules: Rules, pinned: string[] = []): BuildResult | null {
  const pins = pool.filter((p) => pinned.includes(p.key));
  if (pins.length !== new Set(pinned).size) return null;
  const rest = pool.filter((p) => !pinned.includes(p.key)).sort((a, b) => b.xp - a.xp || a.credit - b.credit);
  const size = rules.team_size;
  const n = rest.length;

  // suffix counts per role for feasibility pruning, prefix sums of xp for the upper bound
  const suffixRole: Record<Role, number[]> = { WK: [], BAT: [], AR: [], BOWL: [] };
  for (const r of ROLES) {
    suffixRole[r] = new Array(n + 1).fill(0);
    for (let i = n - 1; i >= 0; i--) suffixRole[r][i] = suffixRole[r][i + 1] + (rest[i].role === r ? 1 : 0);
  }
  const prefix = [0];
  for (const p of rest) prefix.push(prefix[prefix.length - 1] + p.xp);

  const roleCount: Record<Role, number> = { WK: 0, BAT: 0, AR: 0, BOWL: 0 };
  const teamCount = new Map<string, number>();
  let creditTenths = 0;
  let sumXp = 0;
  const chosen: Candidate[] = [];
  const add = (p: Candidate) => {
    chosen.push(p);
    roleCount[p.role]++;
    teamCount.set(p.team, (teamCount.get(p.team) ?? 0) + 1);
    creditTenths += tenth(p.credit);
    sumXp += p.xp;
  };
  const remove = (p: Candidate) => {
    chosen.pop();
    roleCount[p.role]--;
    teamCount.set(p.team, (teamCount.get(p.team) ?? 0) - 1);
    creditTenths -= tenth(p.credit);
    sumXp -= p.xp;
  };

  for (const p of pins) add(p);
  if (chosen.length > size || creditTenths > tenth(rules.credit_cap)) return null;
  for (const r of ROLES) if (roleCount[r] > rules.role_max[r]) return null;
  for (const c of teamCount.values()) if (c > rules.max_per_team) return null;

  let best: Candidate[] | null = null;
  let bestXp = -Infinity;
  const capTenths = tenth(rules.credit_cap);

  const dfs = (i: number) => {
    const need = size - chosen.length;
    if (need === 0) {
      for (const r of ROLES) if (roleCount[r] < rules.role_min[r]) return;
      if (sumXp > bestXp) {
        bestXp = sumXp;
        best = [...chosen];
      }
      return;
    }
    if (n - i < need) return;
    // role-minimum feasibility
    for (const r of ROLES) if (roleCount[r] + suffixRole[r][i] < rules.role_min[r]) return;
    // optimistic bound: take the next `need` best remaining
    if (sumXp + (prefix[i + need] - prefix[i]) <= bestXp) return;

    const p = rest[i];
    if (
      roleCount[p.role] < rules.role_max[p.role] &&
      (teamCount.get(p.team) ?? 0) < rules.max_per_team &&
      creditTenths + tenth(p.credit) <= capTenths
    ) {
      add(p);
      dfs(i + 1);
      remove(p);
    }
    dfs(i + 1);
  };
  dfs(0);

  if (!best) return null;
  const team = best as Candidate[];
  return { team, totalXp: Math.round(bestXp * 10) / 10, credits: creditsUsed(team) };
}

export interface Fix {
  drop: Candidate;
  add: Candidate;
  xpDelta: number;
}

/**
 * Aryan's team is invalid after an override. Keep his pick and suggest the single swaps that make it valid,
 * grouped by who to drop (so the UI can say "to fit this player, drop one of these").
 * `locked` are players he just chose, which must not be suggested for dropping.
 */
export function suggestFixes(team: Candidate[], pool: Candidate[], rules: Rules, locked: string[], limit = 3): Fix[] {
  const inTeam = new Set(team.map((p) => p.key));
  const bench = pool.filter((p) => !inTeam.has(p.key));
  const byDrop = new Map<string, Fix>();
  for (const drop of team) {
    if (locked.includes(drop.key)) continue;
    for (const add of bench) {
      const next = team.filter((p) => p.key !== drop.key).concat(add);
      if (validateTeam(next, rules).length) continue;
      const fix: Fix = { drop, add, xpDelta: Math.round((add.xp - drop.xp) * 10) / 10 };
      const cur = byDrop.get(drop.key);
      if (!cur || fix.xpDelta > cur.xpDelta) byDrop.set(drop.key, fix);
    }
  }
  return [...byDrop.values()].sort((a, b) => b.xpDelta - a.xpDelta).slice(0, limit);
}
