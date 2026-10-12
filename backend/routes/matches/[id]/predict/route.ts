import { handle } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { loadActiveWeights } from '@/backend/db/queries';
import { preflight, stageLabel } from '@/backend/services/preflight';
import { historyFor } from '@/backend/services/history';
import { predictExpectedPoints } from '@/backend/services/pipeline';


/** Step 1 of a run: Gemini estimates expected points for every XI player (strict JSON, specific reasons only). */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const { match, pool, stage } = await preflight(sb, id);
  const { version, weights } = await loadActiveWeights(sb);
  const history = await historyFor(sb, pool.map((p) => ({ key: p.key, name: p.name, team: p.team })), match.starts_at ?? new Date().toISOString(), match.format ?? 'T20', id);
  const rows = await predictExpectedPoints(sb, { match, pool, weights, weightsVersion: version, stageLabel: stageLabel(stage), history });
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
  // keep how each number was built (base + adjustment) so the team card can show it
  must(
    await sb.from('api_cache').upsert([
      { key: `stats:${id}`, payload: { players: history }, fetched_at: new Date().toISOString(), ttl_seconds: 86400 },
      { key: `parts:${id}`, payload: { players: Object.fromEntries(rows.map((r) => [r.key, { base: r.base, adjustment: r.adjustment, basis: r.basis }])) }, fetched_at: new Date().toISOString(), ttl_seconds: 86400 },
    ]),
    'save parts',
  );
  return { count: rows.length, stage, withBase: rows.filter((r) => r.base !== null).length };
});
