import type { SupabaseClient } from '@supabase/supabase-js';
import { gemini, parseJson, S } from '@/backend/integrations/gemini';
import { historyFor } from '@/backend/services/history';
import { pickCaptains, predictExpectedPoints } from '@/backend/services/pipeline';
import { loadActiveWeights, loadRules } from '@/backend/db/queries';
import { buildBestXI } from '@/shared/rules';
import { analyse, teamPoints, type PMPlayer } from '@/shared/backtest';
import { LEGACY_LOGIC_NAME, LOGIC_NAME, LOGIC_VERSION } from '@/shared/form';
import type { Candidate, Role } from '@/shared/types';

/**
 * Back-test: build a team for a match that has ALREADY been played, using only what was knowable beforehand, then
 * compare with what happened. Guards against cheating:
 *  - history is cut off before the match day (historyFor uses played_on < match day);
 *  - no live web search (it could surface the result), so conditions are unknown to the model;
 *  - the squad is the real XI, which is public at the toss, exactly as in a "final" run;
 *  - actual points are read ONLY after the team has been built.
 */
export interface BacktestRecord {
  ref: string;
  logic: string;
  logicName: string;
  createdAt: string;
  date: string;
  title: string;
  venue: string | null;
  event: string | null;
  notes: string[];
  agent: { xi: string[]; captain: string; vc: string; points: number; captainReason: string };
  baseline: { xi: string[]; captain: string; vc: string; points: number };
  hindsight: { xi: string[]; captain: string; vc: string; points: number };
  players: (PMPlayer & { reason: string })[];
  metrics: ReturnType<typeof analyse>['metrics'];
  findings: ReturnType<typeof analyse>['findings'];
  byRole: ReturnType<typeof analyse>['byRole'];
  byPosition: ReturnType<typeof analyse>['byPosition'];
  /** Deterministic check, no Gemini: the same squad scored with the old and the new base formula */
  formulaCheck: { v1: { points: number; mae: number }; v2: { points: number; mae: number }; n: number };
}

async function inferRoles(teamNames: Record<string, string[]>): Promise<Map<string, Role>> {
  const schema = S.obj({ players: S.arr(S.obj({ name: S.str, role: S.enum(['WK', 'BAT', 'AR', 'BOWL']) })) });
  const text = Object.entries(teamNames).map(([t, ns]) => `${t}: ${ns.join(', ')}`).join('\n');
  const { text: out } = await gemini({
    schema, temperature: 0,
    prompt: `These are the playing XIs of a T20 match (names as written in scorecards, initials first). For each cricketer give the role Dream11 lists them under: WK (wicket-keeper), BAT (batter), AR (all-rounder) or BOWL (bowler). Use only general knowledge of the player, not this match's result. Each team has at least one WK.\n${text}`,
  });
  const j = parseJson<{ players: { name: string; role: Role }[] }>(out);
  return new Map(j.players.map((p) => [p.name.toLowerCase().trim(), p.role]));
}

export async function runBacktest(sb: SupabaseClient, ref: string, logic: 'v1' | 'v2' = 'v2'): Promise<BacktestRecord> {
  const legacy = logic === 'v1';
  const { data: rows, error } = await sb.from('player_match_points').select('*').eq('match_ref', ref);
  if (error || !rows?.length) throw new Error(`No Cricsheet rows for match ${ref}. Import the data first.`);
  const date: string = rows[0].played_on;
  const teams = [...new Set(rows.map((r: any) => r.team))] as string[];
  if (teams.length !== 2) throw new Error('Expected exactly two teams.');
  const notes: string[] = [];

  // --- 1. everything the agent may know: squad, roles, history before this day ---
  const byTeam: Record<string, string[]> = {};
  for (const t of teams) byTeam[t] = rows.filter((r: any) => r.team === t).map((r: any) => r.player);
  // Reuse the roles from an earlier run of this same match, so two runs differ only in the logic being tested
  const { data: prevRec } = await sb.from('api_cache').select('payload').like('key', `bt:${ref}:%`).limit(1);
  const prevRoles = new Map<string, Role>((prevRec?.[0]?.payload?.players ?? []).map((p: any) => [String(p.name).toLowerCase().trim(), p.role as Role]));
  const roleMap = prevRoles.size ? prevRoles : await inferRoles(byTeam);
  if (prevRoles.size) notes.push('Player roles were reused from the first run of this match, so the runs differ only in the logic.');
  const pool: Candidate[] = rows.map((r: any) => ({ key: r.name_key, name: r.player, team: r.team, role: (roleMap.get(String(r.player).toLowerCase().trim()) ?? 'BAT') as Role, credit: 0, xp: 0 }));
  const rules = await loadRules(sb);
  const noKeeper = teams.filter((t) => !pool.some((p) => p.team === t && p.role === 'WK'));
  const buildRules = noKeeper.length ? { ...rules, role_min: { ...rules.role_min, WK: 0 } } : rules;
  if (noKeeper.length) notes.push(`No wicket-keeper could be identified for ${noKeeper.join(' and ')}, so the keeper minimum was relaxed.`);
  notes.push('Credits are not used (not knowable afterwards), so only role and team limits apply.');
  notes.push('Pitch and weather were NOT searched (a search could reveal the result); the model only knew the venue and format.');
  notes.push('Squad names come straight from Cricsheet, so name matching here is easier than with Dream11 short names.');

  const hist = await historyFor(sb, pool.map((p) => ({ key: p.key, name: p.name, team: p.team })), date, 'T20', undefined, { legacy });
  const match = { team_a: teams[0], team_b: teams[1], venue: rows[0].venue as string | null, format: 'T20', contest_type: 'small' as const, context: {} };
  const { version: wv, weights } = await loadActiveWeights(sb);
  const preds = await predictExpectedPoints(sb, { match, pool, weights, weightsVersion: wv, stageLabel: `BACKTEST of a finished match: predict as of before it started on ${date}. No live conditions are available.`, history: hist, temperature: 0 });
  const pred = new Map(preds.map((p) => [p.key, p]));
  const withXp: Candidate[] = pool.map((p) => ({ ...p, xp: pred.get(p.key)!.expected_points }));

  // --- 2. build the agent's team with the real production logic ---
  const built = buildBestXI(withXp, buildRules);
  if (!built) throw new Error('No valid XI could be built from this squad.');
  const inXI = new Set(built.team.map((p) => p.key));
  const bench = withXp.filter((p) => !inXI.has(p.key)).sort((a, b) => b.xp - a.xp);
  const cvc = await pickCaptains({ match, xi: built.team, bench, reasons: new Map(preds.map((p) => [p.key, p.reason])), guard: !legacy, temperature: 0 });

  // --- 3. only NOW read what actually happened ---
  const actual = new Map<string, number>(rows.map((r: any) => [r.name_key, Number(r.points)]));
  const batPos = new Map<string, number | null>(rows.map((r: any) => [r.name_key, r.bat_pos]));
  const nameOf = new Map(pool.map((p) => [p.key, p.name]));

  const last5 = (k: string) => { const r = hist[k]?.recent?.slice(0, 5); return r && r.length >= 3 ? r.reduce((s, x) => s + x, 0) / r.length : null; };
  const baselinePool: Candidate[] = pool.map((p) => ({ ...p, xp: last5(p.key) ?? 0 }));
  const baselineBuilt = buildBestXI(baselinePool, buildRules);
  const hindPool: Candidate[] = pool.map((p) => ({ ...p, xp: actual.get(p.key) ?? 0 }));
  const hindBuilt = buildBestXI(hindPool, buildRules);
  if (!baselineBuilt || !hindBuilt) throw new Error('Could not build comparison teams.');

  const topTwo = (xi: Candidate[], score: (p: Candidate) => number) => [...xi].sort((a, b) => score(b) - score(a)).slice(0, 2).map((p) => p.key);
  const [bC, bV] = topTwo(baselineBuilt.team, (p) => p.xp);
  const [hC, hV] = topTwo(hindBuilt.team, (p) => actual.get(p.key) ?? 0);

  const players: (PMPlayer & { reason: string })[] = pool.map((p) => ({
    name: p.name, team: p.team, role: p.role, batPos: batPos.get(p.key) ?? null,
    predicted: pred.get(p.key)!.expected_points, base: pred.get(p.key)!.base, adjustment: pred.get(p.key)!.adjustment,
    actual: actual.get(p.key) ?? 0, baseline: last5(p.key) === null ? null : Math.round((last5(p.key) as number) * 10) / 10,
    inAgentXI: inXI.has(p.key), inHindsightXI: hindBuilt.team.some((q) => q.key === p.key), inBaselineXI: baselineBuilt.team.some((q) => q.key === p.key),
    reason: pred.get(p.key)!.reason,
  })).sort((a, b) => b.actual - a.actual);

  const nm = (k: string) => nameOf.get(k)!;
  const agent = { xi: built.team.map((p) => p.name), captain: nm(cvc.captain), vc: nm(cvc.vc), points: 0 };
  agent.points = teamPoints(players, agent.xi, agent.captain, agent.vc, rules.captain_mult, rules.vc_mult);
  const baseline = { xi: baselineBuilt.team.map((p) => p.name), captain: nm(bC), vc: nm(bV), points: 0 };
  baseline.points = teamPoints(players, baseline.xi, baseline.captain, baseline.vc, rules.captain_mult, rules.vc_mult);
  const hindsight = { xi: hindBuilt.team.map((p) => p.name), captain: nm(hC), vc: nm(hV), points: 0 };
  hindsight.points = teamPoints(players, hindsight.xi, hindsight.captain, hindsight.vc, rules.captain_mult, rules.vc_mult);

  // --- deterministic formula check: old base (flat last-10) vs the current base, same squad, same roles, no Gemini ---
  const legacyBase = (k: string): number | null => {
    const h = hist[k];
    if (!h?.found || !h.n_all) return null;
    const allOk = h.n_all >= 5, recOk = (h.recent?.length ?? 0) >= 3;
    if (allOk && recOk) return 0.5 * h.mean_all! + 0.5 * (h.mean_last10 ?? h.mean_recent!);
    if (allOk) return h.mean_all!;
    if (recOk) return h.mean_last10 ?? h.mean_recent!;
    return null;
  };
  const NO_HISTORY = 40;
  const check = (f: (k: string) => number | null) => {
    const built2 = buildBestXI(pool.map((p) => ({ ...p, xp: f(p.key) ?? NO_HISTORY })), buildRules)!;
    const [c, v] = [...built2.team].sort((a, b) => b.xp - a.xp).slice(0, 2).map((p) => p.key);
    const pts = teamPoints(players, built2.team.map((p) => p.name), nm(c), nm(v), rules.captain_mult, rules.vc_mult);
    const withF = pool.filter((p) => f(p.key) !== null);
    const mae = withF.length ? withF.reduce((sum, p) => sum + Math.abs((f(p.key) as number) - (actual.get(p.key) ?? 0)), 0) / withF.length : 0;
    return { points: pts, mae: Math.round(mae * 10) / 10 };
  };
  const formulaCheck = { v1: check(legacyBase), v2: check((k) => hist[k]?.base ?? null), n: pool.filter((p) => hist[p.key]?.base !== undefined).length };

  const result = analyse(players, agent, baseline, hindsight);
  return {
    ref, logic, logicName: legacy ? LEGACY_LOGIC_NAME : LOGIC_NAME, createdAt: new Date().toISOString(), date,
    title: `${teams[0]} v ${teams[1]}`, venue: rows[0].venue, event: rows[0].event, notes,
    agent: { ...agent, captainReason: cvc.reason }, baseline, hindsight, players,
    metrics: result.metrics, findings: result.findings, byRole: result.byRole, byPosition: result.byPosition, formulaCheck,
  };
}

export async function saveBacktest(sb: SupabaseClient, rec: BacktestRecord) {
  const key = `bt:${rec.ref}:${rec.logic}`;
  await sb.from('api_cache').upsert({ key, payload: rec, fetched_at: new Date().toISOString(), ttl_seconds: 3650 * 86400 });
  return key;
}
