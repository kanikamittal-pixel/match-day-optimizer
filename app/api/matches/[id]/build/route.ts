import { handle, HttpError } from '@/lib/http';
import { must, requireUser } from '@/lib/supabase/server';
import { preflight } from '@/lib/preflight';
import { buildBestXI, validateTeam } from '@/lib/rules';
import { pickCaptains } from '@/lib/pipeline';
import { toCandidates } from '@/lib/data';
import type { Recommended } from '@/lib/types';

export const maxDuration = 60;

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
  return { stage, recommended };
});
