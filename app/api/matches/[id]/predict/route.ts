import { handle } from '@/lib/http';
import { must, requireUser } from '@/lib/supabase/server';
import { loadActiveWeights } from '@/lib/data';
import { preflight, stageLabel } from '@/lib/preflight';
import { predictExpectedPoints } from '@/lib/pipeline';

export const maxDuration = 60;

/** Step 1 of a run: Gemini estimates expected points for every XI player (strict JSON, specific reasons only). */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const { match, pool, stage } = await preflight(sb, id);
  const { version, weights } = await loadActiveWeights(sb);
  const rows = await predictExpectedPoints(sb, { match, pool, weights, weightsVersion: version, stageLabel: stageLabel(stage) });
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
