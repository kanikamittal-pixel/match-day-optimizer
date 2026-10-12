import { handle } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { loadActiveWeights } from '@/backend/db/queries';
import { preflight, stageLabel } from '@/backend/services/preflight';
import { predictExpectedPoints } from '@/backend/services/pipeline';


/** Step 1 of a run: Gemini estimates expected points for every XI player (strict JSON, specific reasons only). */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const { match, pool, stage } = await preflight(sb, id);
  const { version, weights } = await loadActiveWeights(sb);
  const { data: st } = await sb.from('api_cache').select('payload').eq('key', `stats:${id}`).maybeSingle();
  const rows = await predictExpectedPoints(sb, { match, pool, weights, weightsVersion: version, stageLabel: stageLabel(stage), stats: st?.payload?.players });
  const byKey = new Map(pool.map((p) => [p.key, p]));
  must(await sb.from('predictions').delete().eq('match_id', id), 'clear predictions');
  must(
    await sb.from('predictions').insert(
      rows.map((r) => ({
        match_id: id,
        name_key: r.key,
        player_name: r.name,
        team: byKey.get(r.key)!.team,
        role: byKey.get(r.key)!.role,
        batting_position: r.batting_position,
        expected_points: r.expected_points,
        reason: r.reason,
        stage,
        weights_version: version,
      })),
    ),
    'save predictions',
  );
  return { count: rows.length, stage };
});
