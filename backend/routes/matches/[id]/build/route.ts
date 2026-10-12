import { handle, HttpError } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { preflight } from '@/backend/services/preflight';
import { buildBestXI, validateTeam } from '@/shared/rules';
import { pickCaptains } from '@/backend/services/pipeline';
import { toCandidates } from '@/backend/db/queries';
import type { Recommended } from '@/shared/types';


/** Step 2: deterministic XI (code), C/VC (Gemini, re-checked by code), saved as the agent's recommendation. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const force = new URL(req.url).searchParams.get('force') === '1';
  const { match, rules, credits, stage } = await preflight(sb, id);

  const { data: existing } = await sb.from('team_decisions').select('status').eq('match_id', id).maybeSingle();
  if (existing?.status === 'final' && !force) throw new HttpError(409, 'You already finalised a team for this match. Re-running will replace it.', { needsForce: true });

  const preds = must(await sb.from('predictions').select('name_key,expected_points,reason,stage').eq('match_id', id), 'predictions') as any[];
  if (!preds.length) throw new HttpError(422, 'Run expected points first.');
  const xp = new Map(preds.map((p) => [p.name_key, Number(p.expected_points)]));
  const reasons = new Map(preds.map((p) => [p.name_key, p.reason as string]));
  const { pool } = toCandidates(credits, preds.map((p) => p.name_key), xp);

  const built = buildBestXI(pool, rules);
  if (!built) throw new HttpError(422, 'No valid XI exists from these players under the current rules (credit cap, role limits, team cap). Check credits or the rules in Settings.');
  const violations = validateTeam(built.team, rules);
  if (violations.length) throw new HttpError(500, `Internal check failed: ${violations[0].message}`);

  const inXI = new Set(built.team.map((p) => p.key));
  const bench = pool.filter((p) => !inXI.has(p.key)).sort((a, b) => b.xp - a.xp);
  const cvc = await pickCaptains({ match, xi: built.team, bench, reasons });

  const recommended: Recommended = {
    xi: built.team.map((p) => p.key),
    captain: cvc.captain,
    vc: cvc.vc,
    captain_reason: cvc.reason,
    bench: cvc.bench,
    total_xp: built.totalXp,
    credits: built.credits,
    cvc_source: cvc.source,
    credit_mode: built.creditsIgnored ? 'ignored' : 'applied',
  };
  must(
    await sb.from('team_decisions').upsert({
      match_id: id,
      stage,
      recommended,
      final: { xi: recommended.xi, captain: recommended.captain, vc: recommended.vc },
      decisions: [],
      status: 'draft',
      situation_keys: null,
      finalized_at: null,
    }),
    'save recommendation',
  );
  // Keep a timestamped copy of every recommendation (rebuilds overwrite the live row), so the Proof page can show what was
  // recommended and when, even after Aryan changes the team.
  const nameOf = new Map(pool.map((p) => [p.key, p.name]));
  const at = new Date().toISOString();
  await sb.from('api_cache').upsert({
    key: `rec:${id}:${Date.now()}`,
    payload: { at, stage, xi: recommended.xi.map((k) => nameOf.get(k) ?? k), captain: nameOf.get(recommended.captain) ?? recommended.captain, vc: nameOf.get(recommended.vc) ?? recommended.vc },
    fetched_at: at, ttl_seconds: 3650 * 86400,
  });
  return { stage, recommended };
});
