import { handle, HttpError } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { loadAliases } from '@/backend/services/cricsheet-ingest';
import { matchStrictAliases, teamLookup } from '@/shared/names';
import { proofResult, type ProofResult } from '@/shared/proofresult';

export const maxDuration = 60;

interface RecPlayer { name: string; role: string; team: string }
interface Item {
  key: string;
  kind: 'live' | 'backtest';
  title: string;
  date: string | null;
  recommendedAt: string;
  stage?: string;
  recommended: { xi: RecPlayer[]; captain: string; vc: string };
  final?: { xi: RecPlayer[]; captain: string; vc: string } | null; // Aryan's final team when it differs
  note?: string;
  result: ProofResult | null;
  resultNote?: string;
  log: { at: string; stage: string; captain: string; vc: string; xi: string[] }[];
}

/** Everything the agent recommended, frozen with the time it was made, plus any screenshot proof uploaded for it. */
async function buildItems(sb: any): Promise<Item[]> {
  const items: Item[] = [];

  const decisions = must(await sb.from('team_decisions').select('match_id,stage,recommended,final,decisions,created_at'), 'decisions') as any[];
  const ids = decisions.map((d) => d.match_id);
  const matches = ids.length ? (must(await sb.from('matches').select('id,name,starts_at,team_a,team_b').in('id', ids), 'matches') as any[]) : [];
  const credits = ids.length ? (must(await sb.from('match_credits').select('match_id,name_key,name,team,role').in('match_id', ids), 'credits') as any[]) : [];
  const aliases = await loadAliases(sb);
  const viaAlias = (r: string, c: string) => matchStrictAliases(r, [c], aliases) === c;
  const { data: actualRows } = ids.length ? await sb.from('actual_points').select('match_id,player_name,points').in('match_id', ids) : { data: [] as any[] };
  const { data: cache } = await sb.from('api_cache').select('key,payload,fetched_at').or('key.like.rec:*,key.like.bt:%');
  const rows = (cache ?? []) as { key: string; payload: any; fetched_at: string }[];

  for (const d of decisions) {
    const m = matches.find((x) => x.id === d.match_id);
    if (!m) continue;
    const by = new Map(credits.filter((c) => c.match_id === d.match_id).map((c) => [c.name_key, c]));
    const pl = (k: string): RecPlayer => ({ name: by.get(k)?.name ?? k, role: by.get(k)?.role ?? '', team: by.get(k)?.team ?? '' });
    const rec = d.recommended, fin = d.final;
    const recXI = rec.xi.map(pl);
    let result: ProofResult | null = null;
    let resultNote: string | undefined;
    const mine = (actualRows ?? []).filter((a: any) => a.match_id === d.match_id);
    if (mine.length) {
      result = proofResult(mine.map((a: any) => ({ name: a.player_name, team: '', points: Number(a.points) })), recXI, pl(rec.captain).name, pl(rec.vc).name, 'Result entered or fetched for this match', viaAlias);
    } else if (m.starts_at && new Date(m.starts_at).getTime() < Date.now()) {
      // The match has been played: read who actually played from the ball-by-ball history, with no input from anyone
      const day = new Date(m.starts_at).getTime();
      const from = new Date(day - 36 * 3600e3).toISOString().slice(0, 10), to = new Date(day + 36 * 3600e3).toISOString().slice(0, 10);
      const names = [...teamLookup(m.team_a).names, ...teamLookup(m.team_b).names];
      const { data: pmp } = await sb.from('player_match_points').select('match_ref,team,player,points,opponent').in('team', names).gte('played_on', from).lte('played_on', to);
      const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
      const refs = new Set((pmp ?? []).filter((r: any) => teamLookup(m.team_a).names.some((n) => norm(n) === norm(r.team)) || teamLookup(m.team_b).names.some((n) => norm(n) === norm(r.team))).map((r: any) => r.match_ref));
      const one = [...refs].find((ref) => (pmp ?? []).filter((r: any) => r.match_ref === ref).length >= 20);
      if (one) result = proofResult((pmp ?? []).filter((r: any) => r.match_ref === one).map((r: any) => ({ name: r.player, team: r.team, points: Number(r.points) })), recXI, pl(rec.captain).name, pl(rec.vc).name, 'Cricsheet ball-by-ball record of the match', viaAlias);
      else resultNote = 'The match has been played, but the ball-by-ball record is not published yet (it arrives a few days after the match). The comparison appears here on its own.';
    } else resultNote = 'The match has not been played yet. When it has, the players who actually played and their points appear here on their own.';
    if (result) result = { ...result, bestPossible: null }; // a rule-valid best team is only computed for back-tests (Insights)
    const changed = JSON.stringify([...fin.xi].sort()) !== JSON.stringify([...rec.xi].sort()) || fin.captain !== rec.captain || fin.vc !== rec.vc;
    items.push({
      key: `m:${d.match_id}`, kind: 'live', title: m.name, date: m.starts_at, recommendedAt: d.created_at, stage: d.stage,
      recommended: { xi: rec.xi.map(pl), captain: pl(rec.captain).name, vc: pl(rec.vc).name },
      final: changed ? { xi: fin.xi.map(pl), captain: pl(fin.captain).name, vc: pl(fin.vc).name } : null,
      note: changed ? `Aryan changed ${(d.decisions ?? []).length} thing(s) after the recommendation.` : 'Aryan kept the recommendation as it was.',
      result, resultNote,
      log: rows.filter((r) => r.key.startsWith(`rec:${d.match_id}:`)).map((r) => r.payload).sort((a, b) => String(b.at).localeCompare(String(a.at))),
    });
  }

  // matches that had already finished: the team built BEFORE reading the result, with the date it was built
  const bt = rows.filter((r) => /^bt:[^:]+:v\d+$/.test(r.key)).map((r) => r.payload);
  const byRef = new Map<string, any>();
  for (const r of bt) if (!byRef.has(r.ref) || String(r.logic) > String(byRef.get(r.ref).logic)) byRef.set(r.ref, r);
  for (const r of byRef.values()) {
    const pl = (n: string): RecPlayer => { const p = r.players.find((x: any) => x.name === n); return { name: n, role: p?.role ?? '', team: p?.team ?? '' }; };
    items.push({
      key: `bt:${r.ref}`, kind: 'backtest', title: `${r.title} (already played)`, date: r.date, recommendedAt: r.createdAt,
      recommended: { xi: r.agent.xi.map(pl), captain: r.agent.captain, vc: r.agent.vc },
      note: `Built before reading the result, using only earlier matches. It scored ${r.metrics.agent} points against a best possible ${r.metrics.hindsight}.`,
      result: { ...proofResult(r.players.map((p: any) => ({ name: p.name, team: p.team, points: Number(p.actual) })), r.agent.xi.map(pl), r.agent.captain, r.agent.vc, 'Cricsheet ball-by-ball record of the match'), bestPossible: Number(r.metrics.hindsight) }, log: [],
    });
  }
  items.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  return items;
}

export const GET = handle(async () => {
  const { sb } = await requireUser();
  return { items: await buildItems(sb) };
});
