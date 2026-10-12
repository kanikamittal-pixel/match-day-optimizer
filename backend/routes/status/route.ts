import { handle } from '@/backend/http';
import { requireUser } from '@/backend/integrations/supabase';
import { usageToday } from '@/backend/integrations/cricketdata';
import { rapidUsage } from '@/backend/integrations/rapidapi';
import { ensureSeed } from '@/backend/db/queries';

/** Small status block for the dashboard header and health tiles. Database reads only: no external API calls. */
export const GET = handle(async () => {
  const { sb } = await requireUser();
  await ensureSeed(sb);
  const [{ count }, latest, weights, topup] = await Promise.all([
    sb.from('player_match_points').select('*', { count: 'exact', head: true }),
    sb.from('player_match_points').select('played_on').order('played_on', { ascending: false }).limit(1),
    sb.from('scoring_weights').select('version,note').eq('active', true).maybeSingle(),
    sb.from('player_match_points').select('*', { count: 'exact', head: true }).like('match_ref', 'cd-%'),
  ]);
  return {
    history: { rows: count ?? 0, latest: latest.data?.[0]?.played_on ?? null, topUpRows: topup.count ?? 0 },
    weights: { version: weights.data?.version ?? null },
    cricketdata: await usageToday(sb),
    rapid: await rapidUsage(sb),
  };
});
