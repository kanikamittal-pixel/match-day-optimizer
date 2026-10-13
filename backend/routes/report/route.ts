import { handle, HttpError } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { loadRules } from '@/backend/db/queries';
import { loadAliases } from '@/backend/services/cricsheet-ingest';
import { playedPlayers } from '@/backend/services/played';
import { buildBestXI } from '@/shared/rules';
import { matchReport, type RPlayer } from '@/shared/matchreport';
import { matchStrictAliases, pairNames } from '@/shared/names';
import type { Candidate, Role } from '@/shared/types';

export const maxDuration = 60;

/** Back-test of a finished match: everything was stored when the agent built its team before reading the result. */
function fromBacktest(r: any) {
  const players: RPlayer[] = r.players.map((p: any) => ({
    name: p.name, team: p.team, role: p.role, batPos: p.batPos, predicted: p.predicted, base: p.base, adjustment: p.adjustment,
    actual: Number(p.actual), baseline: p.baseline, reason: p.reason ?? null, played: true, inOurXI: false, inTop11: false,
  }));
  return {
    key: `bt:${r.ref}`, kind: 'backtest', title: r.title, date: r.date, recommendedAt: r.createdAt, venue: r.venue, source: 'Cricsheet ball-by-ball record of the match',
    notes: r.notes as string[],
    ourCaptainReason: r.agent.captainReason ?? null,
    report: matchReport(players, r.agent, r.hindsight, r.baseline),
  };
}

export const GET = handle(async (req: Request) => {
  const { sb } = await requireUser();
  const key = new URL(req.url).searchParams.get('key');

  const { data: cache } = await sb.from('api_cache').select('key,payload').like('key', 'bt:%');
  const bt = ((cache ?? []) as { key: string; payload: any }[]).filter((r) => /^bt:[^:]+:v\d+$/.test(r.key)).map((r) => r.payload);
  const latest = new Map<string, any>();
  for (const r of bt) if (!latest.has(r.ref) || String(r.logic) > String(latest.get(r.ref).logic)) latest.set(r.ref, r);

  const decisions = must(await sb.from('team_decisions').select('match_id,recommended,final,created_at'), 'decisions') as any[];
  const ids = decisions.map((d) => d.match_id);
  const matches = ids.length ? (must(await sb.from('matches').select('id,name,starts_at,team_a,team_b').in('id', ids), 'matches') as any[]) : [];

  if (!key) {
    const list = [
      ...decisions.flatMap((d) => { const m = matches.find((x) => x.id === d.match_id); return m ? [{ key: `m:${m.id}`, kind: 'live', title: m.name, date: m.starts_at }] : []; }),
      ...[...latest.values()].map((r) => ({ key: `bt:${r.ref}`, kind: 'backtest', title: `${r.title}`, date: r.date, ourPoints: r.metrics.agent, topPoints: r.metrics.hindsight })),
    ].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
    return { matches: list };
  }

  if (key.startsWith('bt:')) {
    const r = latest.get(key.slice(3));
    if (!r) throw new HttpError(404, 'Unknown match.');
    return fromBacktest(r);
  }

  // a live match the agent recommended a team for
  const id = key.replace(/^m:/, '');
  const d = decisions.find((x) => x.match_id === id), m = matches.find((x) => x.id === id);
  if (!d || !m) throw new HttpError(404, 'Unknown match.');
  const head = { key, kind: 'live', title: m.name, date: m.starts_at, recommendedAt: d.created_at, notes: [] as string[], ourCaptainReason: null };
  const res = await playedPlayers(sb, id, m);
  if ('note' in res) return { ...head, source: null, pending: res.note, report: null };

  const preds = must(await sb.from('predictions').select('name_key,player_name,team,role,batting_position,expected_points,reason').eq('match_id', id), 'predictions') as any[];
  const aliases = await loadAliases(sb);
  const viaAlias = (r: string, c: string) => matchStrictAliases(r, [c], aliases) === c;
  const pair = pairNames(res.players.map((p) => p.name), preds.map((p) => p.player_name), viaAlias);
  const predFor = new Map(pair.paired.map((x) => [x.read, preds.find((p) => p.player_name === x.rec)]));
  const nameOf = new Map(preds.map((p) => [p.name_key, p.player_name]));
  const nm = (k: string) => nameOf.get(k) ?? k;
  const ourXI = (d.recommended.xi as string[]).map(nm);
  const fin = d.final as { xi: string[]; captain: string; vc: string } | null;
  const finXI = fin ? fin.xi.map(nm) : ourXI;
  const changed = !!fin && (JSON.stringify([...finXI].sort()) !== JSON.stringify([...ourXI].sort()) || nm(fin.captain) !== nm(d.recommended.captain) || nm(fin.vc) !== nm(d.recommended.vc));
  // how each expected number was built (history base and conditions adjustment), saved when the prediction was made
  const { data: partsRow } = await sb.from('api_cache').select('payload').eq('key', `parts:${id}`).maybeSingle();
  const parts: Record<string, { base: number | null; adjustment: number | null }> = partsRow?.payload?.players ?? {};
  const players: RPlayer[] = res.players.map((p) => {
    const q = predFor.get(p.name);
    const pt = q ? parts[q.name_key] : undefined;
    // the batting order is only recorded for matches read from the ball-by-ball record
    return { name: q?.player_name ?? p.name, team: q?.team ?? p.team, role: q?.role ?? 'BAT', batPos: p.batPos, batKnown: res.source.startsWith('Cricsheet'), predicted: q ? Number(q.expected_points) : null, base: pt?.base ?? null, adjustment: pt?.adjustment ?? null, actual: p.points, baseline: null, reason: q?.reason ?? null, played: true, inOurXI: false, inTop11: false };
  });
  for (const n of [...new Set([...ourXI, ...finXI])]) if (!players.some((p) => p.name === n)) { // in our team but did not play: scores 0
    const q = preds.find((p) => p.player_name === n);
    if (q) players.push({ name: n, team: q.team, role: q.role, batPos: null, batKnown: false, predicted: Number(q.expected_points), base: parts[q.name_key]?.base ?? null, adjustment: parts[q.name_key]?.adjustment ?? null, actual: 0, baseline: null, reason: q.reason, played: false, inOurXI: false, inTop11: false });
  }
  const rules = await loadRules(sb);
  const pool: Candidate[] = players.filter((p) => p.played).map((p) => ({ key: p.name, name: p.name, team: p.team, role: p.role as Role, credit: 0, xp: p.actual }));
  const noKeeper = [...new Set(pool.map((p) => p.team))].filter((t) => !pool.some((p) => p.team === t && p.role === 'WK'));
  const built = buildBestXI(pool, noKeeper.length ? { ...rules, role_min: { ...rules.role_min, WK: 0 } } : rules);
  if (!built) return { ...head, source: res.source, pending: 'The best possible team could not be worked out for this match.', report: null };
  const topTwo = [...built.team].sort((a, b) => b.xp - a.xp).slice(0, 2).map((p) => p.name);
  const top = { xi: built.team.map((p) => p.name), captain: topTwo[0], vc: topTwo[1] };
  const mult = { c: rules.captain_mult, vc: rules.vc_mult };
  const report = matchReport(players, { xi: ourXI, captain: nm(d.recommended.captain), vc: nm(d.recommended.vc) }, top, null, mult);
  // If Aryan changed the team before finalising, the same report for his version
  const aryanReport = changed && fin ? matchReport(players, { xi: finXI, captain: nm(fin.captain), vc: nm(fin.vc) }, top, null, mult) : null;
  return { ...head, source: res.source, pending: null, report, aryanReport };
});
