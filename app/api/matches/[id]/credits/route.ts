import { handle, HttpError } from '@/server/http';
import { must, requireUser } from '@/server/integrations/supabase';
import { loadMatch } from '@/server/db/queries';
import { nameKey } from '@/shared/names';
import { ROLES } from '@/shared/types';
import { cricket, TTL } from '@/server/integrations/cricketdata';

/** Prefill: last known credits for players on either team, so Aryan only corrects changes. */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const m = await loadMatch(sb, id);
  const rows = must(await sb.from('players').select('name_key,name,team,role,last_credit').in('team', [m.team_a, m.team_b]).not('last_credit', 'is', null), 'prefill');
  const out: { name: string; team: string; role: string; credit: number | string; fromApi?: boolean }[] = (rows as any[]).map((r) => ({ name: r.name, team: r.team, role: r.role, credit: Number(r.last_credit) }));
  // Real squad names from CricketData (cached) so Aryan only types credits. Silent if the API has no squad.
  let apiSquad = 0;
  if (!id.startsWith('manual-') && !id.startsWith('rb-')) {
    try {
      const sq = await cricket<any>(sb, 'match_squad', { id }, TTL.squad);
      const have = new Set(out.map((r) => nameKey(r.name)));
      for (const t of sq.data.data ?? []) {
        const team = [m.team_a, m.team_b].find((x) => nameKey(x) === nameKey(t.teamName) || nameKey(x).includes(nameKey(t.shortname ?? '~~'))) ?? t.teamName;
        for (const p of t.players ?? []) {
          if (have.has(nameKey(p.name))) continue;
          const r = String(p.role ?? '').toLowerCase();
          const role = r.includes('wk') || r.includes('keeper') ? 'WK' : r.includes('allround') ? 'AR' : r.includes('bowl') ? 'BOWL' : 'BAT';
          out.push({ name: p.name, team, role, credit: '', fromApi: true });
          apiSquad++;
        }
      }
    } catch {
      /* no squad available */
    }
  }
  return { rows: out, apiSquad };
});

/** Confirm: saves the table for this match so a re-run never asks again, and updates each player's last credit. */
export const PUT = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const m = await loadMatch(sb, id);
  const { rows } = (await req.json()) as { rows: { name: string; team: string; role: string; credit: number }[] };
  const clean: any[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) {
    const name = String(r.name ?? '').trim();
    const credit = Number(r.credit);
    if (!name) continue;
    if (!ROLES.includes(r.role as any)) problems.push(`${name}: pick a role`);
    if (![m.team_a, m.team_b].includes(r.team)) problems.push(`${name}: pick a team`);
    if (!Number.isFinite(credit) || credit < 4 || credit > 14) problems.push(`${name}: credit looks wrong`);
    const key = nameKey(name);
    if (seen.has(key)) problems.push(`${name}: listed twice`);
    seen.add(key);
    clean.push({ match_id: id, name_key: key, name, team: r.team, role: r.role, credit });
  }
  if (problems.length) throw new HttpError(422, `Fix these before confirming: ${problems.slice(0, 6).join('; ')}`);
  if (clean.length < 11) throw new HttpError(422, 'Need at least 11 players with credits.');
  must(await sb.from('match_credits').delete().eq('match_id', id), 'clear credits');
  must(await sb.from('match_credits').insert(clean), 'save credits');
  must(
    await sb.from('players').upsert(clean.map((c) => ({ name_key: c.name_key, name: c.name, team: c.team, role: c.role, last_credit: c.credit, last_match_id: id, updated_at: new Date().toISOString() })), { onConflict: 'name_key' }),
    'update players',
  );
  return { saved: clean.length };
});
