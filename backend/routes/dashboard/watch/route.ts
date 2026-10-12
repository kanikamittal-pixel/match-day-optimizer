import { handle } from '@/backend/http';
import { requireUser } from '@/backend/integrations/supabase';
import { loadMatch } from '@/backend/db/queries';
import { teamLookup } from '@/shared/names';

export interface Watch {
  player: string;
  team: string;
  n: number;
  recent: number[]; // last 10 fantasy scores, newest first
  mean: number;
}

/**
 * "Players to watch": for the next match, the in-form players of each side, ranked by their average Dream11
 * score over their last 10 T20 matches (Cricsheet history). Database reads only; cached 6 hours.
 */
export const GET = handle(async (req: Request) => {
  const { sb } = await requireUser();
  const id = new URL(req.url).searchParams.get('match') ?? '';
  const key = `watch:${id}`;
  const { data: cached } = await sb.from('api_cache').select('payload,fetched_at').eq('key', key).maybeSingle();
  if (cached && Date.now() - new Date(cached.fetched_at).getTime() < 6 * 3600 * 1000) return cached.payload;

  const m = await loadMatch(sb, id);
  const out: { teams: { team: string; players: Watch[] }[]; note?: string } = { teams: [] };
  if (m.format !== 'T20') return { teams: [], note: 'Form is available for T20 matches only.' };
  const cutoff = (m.starts_at ?? new Date().toISOString()).slice(0, 10);
  const since = new Date(new Date(cutoff).getTime() - 365 * 86400000).toISOString().slice(0, 10);

  for (const team of [m.team_a, m.team_b]) {
    const rows: { player: string; played_on: string; points: number }[] = [];
    for (let from = 0; from < 6000; from += 1000) {
      const { data, error } = await sb.from('player_match_points').select('player,played_on,points').in('team', teamLookup(team).names).eq('gender', teamLookup(team).gender).gte('played_on', since).lt('played_on', cutoff).order('played_on', { ascending: false }).order('match_ref').order('team').order('name_key').range(from, from + 999);
      if (error) return { teams: [], note: 'Fantasy history is not set up yet.' };
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    const by = new Map<string, number[]>();
    for (const r of rows) by.set(r.player, [...(by.get(r.player) ?? []), Number(r.points)]);
    const players: Watch[] = [...by]
      .filter(([, pts]) => pts.length >= 4)
      .map(([player, pts]) => {
        const recent = pts.slice(0, 10);
        return { player, team, n: pts.length, recent, mean: Math.round((recent.reduce((s, x) => s + x, 0) / recent.length) * 10) / 10 };
      })
      .sort((a, b) => b.mean - a.mean)
      .slice(0, 5);
    out.teams.push({ team, players });
  }
  await sb.from('api_cache').upsert({ key, payload: out, fetched_at: new Date().toISOString(), ttl_seconds: 6 * 3600 });
  return out;
});
