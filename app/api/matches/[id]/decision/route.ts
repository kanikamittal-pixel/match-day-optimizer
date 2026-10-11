import { handle, HttpError } from '@/server/http';
import { must, requireUser } from '@/server/integrations/supabase';
import { eligibleKeys, loadCredits, loadMatch, loadRules, situationKey, toCandidates } from '@/server/db/queries';
import { suggestFixes, validateTeam, creditsUsed } from '@/shared/rules';
import type { DecisionEntry, FinalTeam, Recommended } from '@/shared/types';

type Change = { kind: 'swap' | 'captain' | 'vice'; from: string; to: string };

function apply(final: FinalTeam, c: Change): FinalTeam {
  const f: FinalTeam = { ...final, xi: [...final.xi] };
  if (c.kind === 'swap') {
    if (!f.xi.includes(c.from)) throw new HttpError(400, 'That player is not in your XI.');
    if (f.xi.includes(c.to)) throw new HttpError(400, 'That player is already in your XI.');
    f.xi = f.xi.map((k) => (k === c.from ? c.to : k));
    // the incoming player inherits the C/VC badge so the team never has an orphaned captain
    if (f.captain === c.from) f.captain = c.to;
    if (f.vc === c.from) f.vc = c.to;
  } else if (c.kind === 'captain') {
    if (!f.xi.includes(c.to)) throw new HttpError(400, 'Captain must be in the XI.');
    if (f.vc === c.to) f.vc = f.captain; // swap the badges
    f.captain = c.to;
  } else {
    if (!f.xi.includes(c.to)) throw new HttpError(400, 'Vice-captain must be in the XI.');
    if (f.captain === c.to) f.captain = f.vc;
    f.vc = c.to;
  }
  return f;
}

/** Collapse back-and-forth changes (A to B, then B back to A) so the log reflects net decisions. */
function mergeEntry(list: DecisionEntry[], e: DecisionEntry): DecisionEntry[] {
  const prev = list.find((x) => x.kind === e.kind && x.to === e.from);
  if (!prev) return [...list, e];
  const rest = list.filter((x) => x !== prev);
  return prev.from === e.to ? rest : [...rest, { ...e, from: prev.from }];
}

export const GET = handle(async () => ({ ok: true }));

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const body = await req.json();
  const { data: dec } = await sb.from('team_decisions').select('*').eq('match_id', id).maybeSingle();
  if (!dec) throw new HttpError(404, 'Build a team first.');
  const rec = dec.recommended as Recommended;

  if (body.action === 'reset') {
    must(await sb.from('team_decisions').update({ final: { xi: rec.xi, captain: rec.captain, vc: rec.vc }, decisions: [], status: 'draft', finalized_at: null, situation_keys: null }).eq('match_id', id), 'reset');
    return { ok: true };
  }
  if (body.action === 'reopen') {
    const { count } = await sb.from('actual_points').select('*', { count: 'exact', head: true }).eq('match_id', id);
    if (count) throw new HttpError(409, 'Results are already entered for this match.');
    must(await sb.from('team_decisions').update({ status: 'draft', finalized_at: null }).eq('match_id', id), 'reopen');
    return { ok: true };
  }

  const [match, rules, credits] = await Promise.all([loadMatch(sb, id), loadRules(sb), loadCredits(sb, id)]);
  const preds = must(await sb.from('predictions').select('name_key,expected_points,reason').eq('match_id', id), 'predictions') as any[];
  const xp = new Map(preds.map((p) => [p.name_key, Number(p.expected_points)]));
  const reason = new Map(preds.map((p) => [p.name_key, p.reason as string]));
  const eligible = eligibleKeys(match.xi);
  const { pool } = toCandidates(credits, eligible, xp);
  const byKey = new Map(pool.map((p) => [p.key, p]));
  const evaluate = (f: FinalTeam) => {
    const team = f.xi.map((k) => byKey.get(k)!).filter(Boolean);
    const violations = validateTeam(team, rules, new Set(eligible));
    if (team.length !== f.xi.length) violations.push({ code: 'missing_data', message: 'A player has no credit value.' });
    return { team, violations, credits: creditsUsed(team) };
  };
  const current = dec.final as FinalTeam;

  if (body.action === 'finalize') {
    const ev = evaluate(current);
    if (ev.violations.length) throw new HttpError(422, 'This team is not valid for Dream11 yet.', { violations: ev.violations });
    const entries = (dec.decisions ?? []) as DecisionEntry[];
    const keys = entries.map((e) => (e.kind === 'swap' ? situationKey(byKey.get(e.to)?.role ?? '?', match.context?.pitch_type) : e.kind === 'captain' ? 'Captaincy' : 'Vice-captaincy'));
    must(await sb.from('team_decisions').update({ status: 'final', finalized_at: new Date().toISOString(), situation_keys: keys }).eq('match_id', id), 'finalize');
    return { ok: true };
  }

  const change = body.change as Change;
  if (!change?.kind || !change.to) throw new HttpError(400, 'Missing change.');
  if (change.kind === 'swap' && !byKey.has(change.to)) throw new HttpError(400, 'That player is not in the XI/impact list.');
  const next = apply(current, change);
  const ev = evaluate(next);

  if (body.action === 'preview') {
    const from = byKey.get(change.from);
    const to = byKey.get(change.to);
    let agentCase: string;
    if (change.kind === 'swap' && from && to) {
      const d = Math.round((to.xp - from.xp) * 10) / 10;
      agentCase = `Agent's case: ${from.name} projects ${from.xp} xP (${reason.get(from.key)}). ${to.name} projects ${to.xp} xP (${reason.get(to.key)}). The swap is ${d >= 0 ? `+${d}` : d} xP for the team.`;
    } else if (from && to) {
      const m = change.kind === 'captain' ? rules.captain_mult : rules.vc_mult;
      const d = Math.round((to.xp - from.xp) * m * 10) / 10;
      agentCase = `Agent's case: ${from.name} projects ${from.xp} xP (${reason.get(from.key)}). ${to.name} projects ${to.xp} xP. At ${m}x that is ${d >= 0 ? `+${d}` : d} xP.`;
    } else agentCase = '';
    const locked = [change.to];
    const fixes = ev.violations.length ? suggestFixes(ev.team, pool, rules, locked).map((f) => ({ drop: f.drop.name, drop_key: f.drop.key, add: f.add.name, add_key: f.add.key, xp_delta: f.xpDelta })) : [];
    return { agentCase, valid: !ev.violations.length, violations: ev.violations, fixes, credits: ev.credits };
  }

  if (body.action === 'commit') {
    const tag = body.tag === 'reasoned' ? 'reasoned' : 'gut';
    const entry: DecisionEntry = { kind: change.kind, from: change.from, to: change.to, tag, ...(body.reason ? { reason: String(body.reason).slice(0, 200) } : {}) };
    const decisions = mergeEntry((dec.decisions ?? []) as DecisionEntry[], entry);
    must(await sb.from('team_decisions').update({ final: next, decisions, status: 'draft' }).eq('match_id', id), 'save override');
    return { ok: true, valid: !ev.violations.length, violations: ev.violations, credits: ev.credits };
  }
  throw new HttpError(400, 'Unknown action.');
});
