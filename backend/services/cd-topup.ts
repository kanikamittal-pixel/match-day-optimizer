import type { SupabaseClient } from '@supabase/supabase-js';
import { cricket, TTL } from '@/backend/integrations/cricketdata';
import { aggregatesFromScorecard } from '@/backend/services/scorecard';
import { loadAliases } from '@/backend/services/cricsheet-ingest';
import { scoreAgg, type ScoreRole } from '@/shared/scoring';
import { linkRoster, nameKey, uniqueCanon } from '@/shared/names';

/**
 * Cricsheet publishes with a delay. For finished T20s newer than its latest match, this fills the gap from CricketData
 * scorecards so the "recent form" of a team is never missing its last few matches. Rows are tagged match_ref = cd-<id>
 * and are removed automatically once Cricsheet has the same match (see reconcile). Dot balls are estimated.
 */
const stripWomen = (t: string) => t.replace(/\s+(women('s)?|w)\s*$/i, '').trim();
const shift = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86400000).toISOString().slice(0, 10);

export interface PendingMatch { id: string; title: string; date: string; reason: string }
export interface TopUpResult { pending: PendingMatch[]; added: { id: string; title: string; date: string; players: number }[]; skipped: string[]; reconciled: number; note?: string }

export async function topUpFromCricketData(sb: SupabaseClient, maxMatches = 6): Promise<TopUpResult> {
  const out: TopUpResult = { added: [], skipped: [], reconciled: 0, pending: [] };
  const { data: last } = await sb.from('player_match_points').select('played_on').not('match_ref', 'like', 'cd-%').order('played_on', { ascending: false }).limit(1);
  const latest: string = last?.[0]?.played_on ?? '2000-01-01';
  let list: any[] = [];
  try { list = ((await cricket<any>(sb, 'currentMatches', { offset: '0' }, TTL.matches, false, true)).data.data ?? []) as any[]; } catch (e: any) { out.note = `CricketData fixtures unavailable: ${e?.message ?? e}`; return out; }

  const done = new Set(((await sb.from('player_match_points').select('match_ref').like('match_ref', 'cd-%')).data ?? []).map((r: any) => r.match_ref));
  const aliases = await loadAliases(sb);
  const cands = list.filter((m) => m.matchEnded && /t20/i.test(String(m.matchType)) && Array.isArray(m.teams) && m.teams.length === 2 && String(m.dateTimeGMT).slice(0, 10) > latest && !done.has(`cd-${m.id}`));

  const addedIds = new Set<string>();
  for (const m of cands.slice(0, maxMatches)) {
    const date = String(m.dateTimeGMT).slice(0, 10);
    const women = m.teams.some((t: string) => /women/i.test(t));
    const gender = women ? 'female' : 'male';
    const teams = (m.teams as string[]).map(stripWomen);
    // Cricsheet may already have it (same teams, within a day): then there is nothing to add
    const { data: dup } = await sb.from('player_match_points').select('match_ref').in('team', teams).eq('gender', gender).gte('played_on', shift(date, -1)).lte('played_on', shift(date, 1)).not('match_ref', 'like', 'cd-%').limit(1);
    if (dup?.length) { out.skipped.push(`${m.name}: already in Cricsheet`); continue; }
    let card: any;
    try { card = (await cricket<any>(sb, 'match_scorecard', { id: m.id }, TTL.scorecard, false, true)).data.data; } catch (e: any) { out.skipped.push(`${m.name}: ${e?.message ?? 'scorecard unavailable'}`); break; }
    if (!card?.scorecard?.length) { out.skipped.push(`${m.name}: empty scorecard`); continue; }

    // who belongs to which side, and batting order
    const teamOf = new Map<string, string>();
    const batPos = new Map<string, number>();
    for (const inn of card.scorecard) {
      const batTeam = stripWomen(String(inn.inning ?? '').replace(/\s+Inning.*$/i, ''));
      const bowlTeam = teams.find((t) => t !== batTeam) ?? teams[0];
      (inn.batting ?? []).forEach((b: any, i: number) => { const n = b.batsman?.name; if (n) { teamOf.set(n, batTeam); batPos.set(n, i + 1); } });
      for (const b of inn.bowling ?? []) if (b.bowler?.name && !teamOf.has(b.bowler.name)) teamOf.set(b.bowler.name, bowlTeam);
      for (const c of inn.catching ?? []) if (c.catcher?.name && !teamOf.has(c.catcher.name)) teamOf.set(c.catcher.name, bowlTeam);
    }
    const aggs = aggregatesFromScorecard(card.scorecard, { estimateDots: true });

    // map CricketData's full names onto the names Cricsheet uses, within each team's recent roster
    const roster = new Map<string, string[]>();
    for (const t of teams) {
      const { data } = await sb.from('player_match_points').select('player').eq('team', t).eq('gender', gender).not('match_ref', 'like', 'cd-%').gte('played_on', shift(date, -1100)).order('played_on', { ascending: false }).order('match_ref').order('team').order('name_key').limit(1500);
      roster.set(t, [...new Set((data ?? []).map((r: any) => r.player as string))]);
    }
    // link each scorecard player to the name Cricsheet already uses for him, so his history stays in one piece
    const linkOf = new Map<string, string>();
    for (const t of teams) {
      const mine = [...aggs.keys()].filter((n) => teamOf.get(n) === t).map((n) => ({ key: n, names: [n] }));
      for (const [k, v] of linkRoster(mine, roster.get(t) ?? [], aliases)) linkOf.set(`${t}|${k}`, v);
    }
    const pre: { name: string; agg: any; t: string; canon: string }[] = [];
    for (const [name, agg] of aggs) {
      const t = teamOf.get(name);
      if (!t) continue;
      pre.push({ name, agg, t, canon: linkOf.get(`${t}|${name}`) ?? name });
    }
    const canons = uniqueCanon(pre.map((p) => ({ team: p.t, name: p.name, canon: p.canon })));
    const rows: any[] = [];
    for (const [i, { name, agg, t }] of pre.entries()) {
      const canon = canons[i];
      const pos = batPos.get(name) ?? null;
      const role: ScoreRole | undefined = agg.ballsBowled >= 12 && (pos === null || pos >= 8) ? 'BOWL' : undefined;
      rows.push({ match_ref: `cd-${m.id}`, team: t, name_key: nameKey(canon), player: canon, opponent: teams.find((x) => x !== t) ?? '', played_on: date, match_type: 'T20', gender, venue: card.venue ?? null, event: String(m.name).split(',').slice(1).join(',').trim() || null, points: Math.round(scoreAgg(agg, role) * 2) / 2, bat_pos: pos });
    }
    if (!rows.length) { out.skipped.push(`${m.name}: no players read`); continue; }
    const { error } = await sb.from('player_match_points').upsert(rows, { onConflict: 'match_ref,team,name_key' });
    if (error) { out.skipped.push(`${m.name}: ${error.message}`); continue; }
    out.added.push({ id: m.id, title: m.name, date, players: rows.length });
    addedIds.add(m.id);
  }
  out.reconciled = await reconcile(sb);
  // The waiting list: finished T20s newer than Cricsheet that we could not add yet. Retried at every refresh.
  const reasonFor = (id: string) => out.skipped.find((x) => x.includes(String(list.find((m) => m.id === id)?.name ?? '~'))) ?? 'waiting for the next refresh';
  out.pending = cands.filter((m) => !addedIds.has(m.id) && !out.skipped.some((x) => x.endsWith('already in Cricsheet') && x.startsWith(String(m.name)))).map((m) => ({ id: m.id, title: String(m.name), date: String(m.dateTimeGMT).slice(0, 10), reason: reasonFor(m.id).replace(String(m.name) + ': ', '') }));
  await sb.from('api_cache').upsert({ key: 'cd:pending', payload: { at: new Date().toISOString(), items: out.pending }, fetched_at: new Date().toISOString(), ttl_seconds: 7 * 86400 });
  return out;
}

/** Remove cd- rows for any match Cricsheet has since published (same teams within a day), so nothing is counted twice. */
export async function reconcile(sb: SupabaseClient): Promise<number> {
  const { data } = await sb.from('player_match_points').select('match_ref,team,opponent,played_on,gender').like('match_ref', 'cd-%');
  const seen = new Map<string, { team: string; opponent: string; played_on: string; gender: string }>();
  for (const r of data ?? []) if (!seen.has(r.match_ref)) seen.set(r.match_ref, r as any);
  let removed = 0;
  for (const [ref, m] of seen) {
    const { data: dup } = await sb.from('player_match_points').select('match_ref').eq('team', m.team).eq('opponent', m.opponent).eq('gender', m.gender).gte('played_on', shift(m.played_on, -1)).lte('played_on', shift(m.played_on, 1)).not('match_ref', 'like', 'cd-%').limit(1);
    if (dup?.length) { await sb.from('player_match_points').delete().eq('match_ref', ref); removed++; }
  }
  return removed;
}


