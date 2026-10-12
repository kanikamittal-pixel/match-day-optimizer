import { handle } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { eligibleKeys, loadCredits, loadMatch } from '@/backend/db/queries';
import { historyFor } from '@/backend/services/history';
import type { PlayerHistory } from '@/shared/form';

const key = (id: string) => `stats:${id}`;

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const { data } = await sb.from('api_cache').select('payload').eq('key', key(id)).maybeSingle();
  return { players: (data?.payload?.players ?? {}) as Record<string, PlayerHistory> };
});

/** Fantasy history (overall + last 10) for every XI player, from stored Cricsheet data. Cheap: only database reads. */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const m = await loadMatch(sb, id);
  const credits = await loadCredits(sb, id);
  const keys = new Set(eligibleKeys(m.xi));
  const list = credits.filter((c) => keys.has(c.name_key)).map((c) => ({ key: c.name_key, name: c.name, team: c.team }));
  const players = await historyFor(sb, list, m.starts_at ?? new Date().toISOString(), m.format ?? 'T20', id);
  must(await sb.from('api_cache').upsert({ key: key(id), payload: { players }, fetched_at: new Date().toISOString(), ttl_seconds: 86400 }), 'save stats');
  const withBase = Object.values(players).filter((h) => h.base !== undefined).length;
  return { total: list.length, withBase, found: Object.values(players).filter((h) => h.found).length, players };
});
