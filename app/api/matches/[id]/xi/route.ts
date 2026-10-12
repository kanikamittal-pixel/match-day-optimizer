import { handle, HttpError } from '@/server/http';
import { must, requireUser } from '@/server/integrations/supabase';
import { loadCredits, loadMatch } from '@/server/db/queries';
import { cricket, TTL } from '@/server/integrations/cricketdata';
import { matchName } from '@/shared/names';
import type { MatchXI } from '@/shared/types';

/** Save the XI Aryan has set (checkboxes and/or pasted names). */
export const PUT = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const m = await loadMatch(sb, id);
  const credits = await loadCredits(sb, id);
  const known = credits.map((c) => ({ key: c.name_key, name: c.name }));
  const b = (await req.json()) as { teamA?: string[]; teamB?: string[]; impact?: string[]; pasted?: string; confirmed: boolean; source?: MatchXI['source'] };

  let teamA = b.teamA ?? [];
  let teamB = b.teamB ?? [];
  const unmatched: string[] = [];
  if (b.pasted?.trim()) {
    // Paste format: lines of names; a line "Team B:" / the second team's name switches sides; "Impact:" starts impact subs
    teamA = [];
    teamB = [];
    const impact: string[] = [];
    let side: 'A' | 'B' | 'I' = 'A';
    const lc = (s: string) => s.toLowerCase();
    for (const raw of b.pasted.split(/\n|,/).map((s) => s.trim()).filter(Boolean)) {
      if (lc(raw).startsWith('impact')) { side = 'I'; continue; }
      if (lc(m.team_b).includes(lc(raw.replace(/:$/, ''))) && raw.endsWith(':')) { side = 'B'; continue; }
      if (lc(m.team_a).includes(lc(raw.replace(/:$/, ''))) && raw.endsWith(':')) { side = 'A'; continue; }
      const key = matchName(raw, known);
      if (!key) { unmatched.push(raw); continue; }
      const team = credits.find((c) => c.name_key === key)!.team;
      if (side === 'I') impact.push(key);
      else if (team === m.team_a) teamA.push(key);
      else teamB.push(key);
    }
    b.impact = impact;
  }
  const xi: MatchXI = { teamA, teamB, impact: b.impact ?? [], confirmed: !!b.confirmed, source: b.pasted ? 'manual' : b.source ?? 'manual' };
  must(await sb.from('matches').update({ xi }).eq('id', id), 'save XI');
  return { xi, unmatched };
});

/** Pull toss + squads from CricketData (cached). Squad is a pool, not the announced XI; Aryan confirms the XI. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const m = await loadMatch(sb, id);
  if (id.startsWith('manual-') || id.startsWith('rb-')) throw new HttpError(400, 'Manual matches have no API data. Enter the XI by hand.', { manualFallback: true });
  const force = new URL(req.url).searchParams.get('force') === '1';
  const info = await cricket<any>(sb, 'match_info', { id }, TTL.matchInfo, force);
  const d = info.data.data ?? {};
  const toss = d.tossWinner ? { winner: d.tossWinner, decision: d.tossChoice } : null;
  const credits = await loadCredits(sb, id);
  const known = credits.map((c) => ({ key: c.name_key, name: c.name }));
  let squadNote = '';
  let xi: MatchXI | null = m.xi;
  try {
    const squad = await cricket<any>(sb, 'match_squad', { id }, TTL.squad, force);
    const players: { team: string; name: string; key: string | null }[] = [];
    for (const t of squad.data.data ?? []) for (const p of t.players ?? []) players.push({ team: t.teamName, name: p.name, key: matchName(p.name, known) });
    squadNote = `Squad lists ${players.length} players; the app cannot tell the announced XI from it, so tick the XI yourself.`;
    if (!xi && credits.length) {
      // Dream11 shows the announced XI after the toss; before it, the full squad. Default = everyone with credits (probable pool).
      xi = { teamA: credits.filter((c) => c.team === m.team_a).map((c) => c.name_key), teamB: credits.filter((c) => c.team === m.team_b).map((c) => c.name_key), impact: [], confirmed: false, source: 'probable' };
    }
  } catch (e) {
    squadNote = e instanceof HttpError ? e.message : 'Squad unavailable.';
  }
  must(await sb.from('matches').update({ toss, status: d.status ?? m.status, xi }).eq('id', id), 'save toss');
  return { toss, xi, note: squadNote, tossDone: !!toss };
});
