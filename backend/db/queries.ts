import type { SupabaseClient } from '@supabase/supabase-js';
import { must } from '@/backend/integrations/supabase';
import { DEFAULT_RULES, DEFAULT_WEIGHTS } from '@/shared/weights';
import { flattenRules } from '@/shared/scoring';
import type { Candidate, Rules, MatchXI, Role } from '@/shared/types';
import { HttpError } from '@/backend/http';

/** First-run seeding: rules row and approved weights v1. Rules are never hard-coded elsewhere. */
export async function ensureSeed(sb: SupabaseClient) {
  const { data: r } = await sb.from('rules_config').select('id').eq('id', 1).maybeSingle();
  if (!r) must(await sb.from('rules_config').insert({ id: 1, ...DEFAULT_RULES }), 'seed rules');
  const { data: w } = await sb.from('scoring_weights').select('version').limit(1);
  if (!w?.length)
    must(await sb.from('scoring_weights').insert({ version: 1, weights: DEFAULT_WEIGHTS, note: 'Initial Dream11 T20 weights', active: true }), 'seed weights');
  // v2 = the current Dream11 T20 table (from the Predict-11 research). Seeded INACTIVE: Aryan activates it in Settings
  // after checking the values against the points-system page in the Dream11 app.
  const { data: v2 } = await sb.from('scoring_weights').select('version').eq('version', 2).maybeSingle();
  if (!v2)
    must(await sb.from('scoring_weights').insert({ version: 2, weights: flattenRules(), note: 'Current Dream11 T20 table (boundary +4, six +6, wicket +30, dot ball +1, SR bands). Not active until you approve it.', active: false }), 'seed weights v2');
}

export async function loadRules(sb: SupabaseClient): Promise<Rules> {
  await ensureSeed(sb);
  const row = must(await sb.from('rules_config').select('*').eq('id', 1).single(), 'load rules');
  return {
    credit_cap: Number(row.credit_cap),
    team_size: row.team_size,
    role_min: row.role_min,
    role_max: row.role_max,
    max_per_team: row.max_per_team,
    captain_mult: Number(row.captain_mult),
    vc_mult: Number(row.vc_mult),
  };
}

/** Only the ACTIVE (approved) weights are ever used for predictions. */
export async function loadActiveWeights(sb: SupabaseClient): Promise<{ version: number; weights: Record<string, number> }> {
  await ensureSeed(sb);
  const row = must(await sb.from('scoring_weights').select('version,weights').eq('active', true).single(), 'load weights');
  return { version: row.version, weights: row.weights };
}

export async function loadPlaybook(sb: SupabaseClient) {
  const rows = must(await sb.from('playbook_rules').select('id,situation,rule,owner,version').eq('active', true).order('created_at'), 'load playbook');
  return rows as { id: string; situation: string; rule: string; owner: 'agent' | 'aryan'; version: number }[];
}

export async function loadMatch(sb: SupabaseClient, id: string) {
  const { data } = await sb.from('matches').select('*').eq('id', id).maybeSingle();
  if (!data) throw new HttpError(404, 'Match not found.');
  return data as {
    id: string; name: string; team_a: string; team_b: string; venue: string | null; format: string | null;
    starts_at: string | null; status: string | null; contest_type: 'small' | 'grand';
    toss: { winner?: string; decision?: string } | null; xi: MatchXI | null; context: any; context_fetched_at: string | null;
  };
}

export async function loadCredits(sb: SupabaseClient, matchId: string) {
  return must(await sb.from('match_credits').select('*').eq('match_id', matchId).order('team').order('name'), 'load credits') as {
    name_key: string; name: string; team: string; role: Role; credit: number;
  }[];
}

/** Eligible = in the XI lists or announced impact subs. Missing credits are reported, never guessed. */
export function eligibleKeys(xi: MatchXI | null): string[] {
  if (!xi) return [];
  return [...new Set([...xi.teamA, ...xi.teamB, ...xi.impact])];
}

export function toCandidates(
  credits: { name_key: string; name: string; team: string; role: Role; credit: number }[],
  keys: string[],
  xp: Map<string, number> = new Map(),
): { pool: Candidate[]; missing: string[] } {
  const byKey = new Map(credits.map((c) => [c.name_key, c]));
  const pool: Candidate[] = [];
  const missing: string[] = [];
  for (const k of keys) {
    const c = byKey.get(k);
    if (!c) missing.push(k);
    else pool.push({ key: k, name: c.name, team: c.team, role: c.role, credit: Number(c.credit), xp: xp.get(k) ?? 0 });
  }
  return { pool, missing };
}

export type PitchBucket = string;
export function situationKey(role: string, pitch?: string | null): string {
  return `${role} · ${(pitch ?? 'unknown').replace(/_/g, ' ')}`;
}
