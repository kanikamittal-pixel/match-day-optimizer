import { handle } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { eligibleKeys, loadCredits, loadMatch } from '@/backend/db/queries';
import { careerStatsFor, type PlayerStats } from '@/backend/services/playerstats';

const key = (id: string) => `stats:${id}`;

export async function loadStats(sb: any, id: string): Promise<Record<string, PlayerStats>> {
  const { data } = await sb.from('api_cache').select('payload').eq('key', key(id)).maybeSingle();
  return (data?.payload?.players ?? {}) as Record<string, PlayerStats>;
}

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  return { players: await loadStats(sb, id) };
});

/** Overall (career) stats for every XI player from CricketData. Per-player calls are cached 7 days, so repeat players are free. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const force = new URL(req.url).searchParams.get('force') === '1';
  const { data: cached } = await sb.from('api_cache').select('payload,fetched_at').eq('key', key(id)).maybeSingle();
  if (cached && !force && Date.now() - new Date(cached.fetched_at).getTime() < 24 * 3600 * 1000) {
    const players = cached.payload.players as Record<string, PlayerStats>;
    return { found: Object.values(players).filter((s) => s.found).length, total: Object.keys(players).length, players, cached: true };
  }
  const m = await loadMatch(sb, id);
  const credits = await loadCredits(sb, id);
  const keys = new Set(eligibleKeys(m.xi));
  const list = credits.filter((c) => keys.has(c.name_key));
  const out: Record<string, PlayerStats> = {};
  for (let i = 0; i < list.length; i += 5) {
    const batch = list.slice(i, i + 5);
    const res = await Promise.all(batch.map((p) => careerStatsFor(sb, { name: p.name, team: p.team }, m.format ?? 'T20')));
    batch.forEach((p, j) => (out[p.name_key] = res[j]));
  }
  must(await sb.from('api_cache').upsert({ key: key(id), payload: { players: out }, fetched_at: new Date().toISOString(), ttl_seconds: 86400 }), 'save stats');
  return { found: Object.values(out).filter((s) => s.found).length, total: list.length, players: out };
});
