import { handle } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import type { DecisionEntry, FinalTeam, Recommended } from '@/shared/types';

/**
 * Where Aryan's choices differ from the agent's, and what pattern (if any) that shows. Built only from his saved
 * overrides. Nothing here changes the agent: a pattern becomes a playbook rule only when he taps to add it.
 */
export const GET = handle(async () => {
  const { sb } = await requireUser();
  const decisions = must(await sb.from('team_decisions').select('match_id,recommended,final,decisions,status,created_at'), 'decisions') as any[];
  const withChanges = decisions.filter((d) => (d.decisions ?? []).length > 0);
  const rules = must(await sb.from('playbook_rules').select('id,situation,rule,owner,active').eq('active', true), 'playbook') as any[];
  if (!decisions.length) return { teams: 0, withOverrides: 0, matches: [], flows: [], summary: null, suggestion: null, rules };

  const ids = decisions.map((d) => d.match_id);
  const [matchesRes, predsRes, credRes, actRes] = await Promise.all([
    sb.from('matches').select('id,name,starts_at').in('id', ids),
    sb.from('predictions').select('match_id,name_key,player_name,expected_points').in('match_id', ids),
    sb.from('match_credits').select('match_id,name_key,role,team').in('match_id', ids),
    sb.from('actual_points').select('match_id,name_key,points').in('match_id', ids),
  ]);
  const matches = must(matchesRes, 'matches') as any[], preds = must(predsRes, 'preds') as any[], cred = must(credRes, 'credits') as any[], acts = must(actRes, 'acts') as any[];

  const out: any[] = [];
  const flows = new Map<string, number>();
  let swaps = 0, gave = 0, gut = 0, reasoned = 0, capChanges = 0;
  const capRanks: number[] = [];

  for (const d of decisions) {
    const m = matches.find((x) => x.id === d.match_id);
    const xp = new Map<string, number>(preds.filter((p) => p.match_id === d.match_id).map((p) => [p.name_key, Number(p.expected_points)]));
    const nm = new Map<string, string>(preds.filter((p) => p.match_id === d.match_id).map((p) => [p.name_key, p.player_name]));
    const role = new Map<string, string>(cred.filter((c) => c.match_id === d.match_id).map((c) => [c.name_key, c.role]));
    const actual = new Map<string, number>(acts.filter((a) => a.match_id === d.match_id).map((a) => [a.name_key, Number(a.points)]));
    const rec = d.recommended as Recommended, fin = d.final as FinalTeam;
    const kept = rec.xi.filter((k) => fin.xi.includes(k)).length;
    const entries = (d.decisions ?? []) as DecisionEntry[];
    const item = { match: m?.name ?? d.match_id, date: m?.starts_at ?? null, kept, size: rec.xi.length, status: d.status, swaps: [] as any[], captain: null as any };
    for (const e of entries) {
      if (e.kind === 'swap') {
        swaps++; if (e.tag === 'gut') gut++; else reasoned++;
        const f = xp.get(e.from) ?? 0, t = xp.get(e.to) ?? 0;
        gave += f - t;
        const flow = `${role.get(e.from) ?? '?'} to ${role.get(e.to) ?? '?'}`;
        flows.set(flow, (flows.get(flow) ?? 0) + 1);
        item.swaps.push({ from: nm.get(e.from) ?? e.from, to: nm.get(e.to) ?? e.to, fromRole: role.get(e.from), toRole: role.get(e.to), fromXp: f, toXp: t, tag: e.tag, reason: e.reason ?? null, fromActual: actual.get(e.from) ?? null, toActual: actual.get(e.to) ?? null });
      } else if (e.kind === 'captain') {
        capChanges++;
        const ranked = [...fin.xi].sort((a, b) => (xp.get(b) ?? 0) - (xp.get(a) ?? 0));
        const rank = 1 + ranked.indexOf(e.to);
        if (rank > 0) capRanks.push(rank);
        item.captain = { from: nm.get(e.from) ?? e.from, to: nm.get(e.to) ?? e.to, rankInAgentList: rank > 0 ? rank : null, tag: e.tag, fromActual: actual.get(e.from) ?? null, toActual: actual.get(e.to) ?? null };
      }
    }
    out.push(item);
  }

  const flowList = [...flows].map(([flow, n]) => ({ flow, n })).sort((a, b) => b.n - a.n);
  const top = flowList[0];
  const [fromRole, toRole] = top ? top.flow.split(' to ') : ['', ''];
  const word = (r: string) => ({ BAT: 'batters', BOWL: 'bowlers', AR: 'all-rounders', WK: 'wicket-keepers' } as Record<string, string>)[r] ?? r;
  const already = rules.some((r) => r.situation.toLowerCase().includes(word(toRole)) && r.situation.toLowerCase().includes(word(fromRole)));
  const suggestion = top && top.n >= 2 && fromRole !== toRole && !already
    ? { situation: `Prefer ${word(toRole)} over ${word(fromRole)}`, rule: `When two players are close in expected points, pick the ${word(toRole).replace(/s$/, '')} over the ${word(fromRole).replace(/s$/, '')}.`, evidence: `${top.n} of your ${swaps} swaps moved a slot from ${word(fromRole)} to ${word(toRole)}.` }
    : null;
  return {
    teams: decisions.length, withOverrides: withChanges.length, matches: out, flows: flowList,
    summary: { swaps, gut, reasoned, avgGivenUp: swaps ? Math.round((gave / swaps) * 10) / 10 : 0, captainChanges: capChanges, avgCaptainRank: capRanks.length ? Math.round((capRanks.reduce((s, x) => s + x, 0) / capRanks.length) * 10) / 10 : null },
    suggestion, rules,
  };
});
