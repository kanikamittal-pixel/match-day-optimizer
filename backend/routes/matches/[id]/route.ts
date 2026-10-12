import { handle } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { loadCredits, loadMatch, loadRules, loadActiveWeights } from '@/backend/db/queries';

export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const [match, credits, rules, weights] = await Promise.all([loadMatch(sb, id), loadCredits(sb, id), loadRules(sb), loadActiveWeights(sb)]);
  const { data: decision } = await sb.from('team_decisions').select('*').eq('match_id', id).maybeSingle();
  const predictions = must(await sb.from('predictions').select('*').eq('match_id', id), 'predictions');
  const actuals = must(await sb.from('actual_points').select('*').eq('match_id', id), 'actuals');
  const { data: st } = await sb.from('api_cache').select('payload').eq('key', `stats:${id}`).maybeSingle();
  return { match, credits, rules, weightsVersion: weights.version, decision, predictions, hasActuals: actuals.length > 0, stats: st?.payload?.players ?? {} };
});

export const PATCH = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const b = await req.json();
  const patch: Record<string, unknown> = {};
  if (b.contest_type === 'small' || b.contest_type === 'grand') patch.contest_type = b.contest_type;
  if (typeof b.venue === 'string') patch.venue = b.venue;
  must(await sb.from('matches').update(patch).eq('id', id), 'update match');
  return { ok: true };
});
