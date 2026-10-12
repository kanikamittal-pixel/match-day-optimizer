import { handle, HttpError } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { loadActiveWeights } from '@/backend/db/queries';

export const GET = handle(async () => {
  const { sb } = await requireUser();
  return { suggestions: must(await sb.from('weight_suggestions').select('*').order('created_at', { ascending: false }).limit(40), 'suggestions') };
});

/** Aryan approves or rejects each suggested change. Approval creates a NEW weights version; nothing is edited in place. */
export const POST = handle(async (req: Request) => {
  const { sb } = await requireUser();
  const { id, decision } = await req.json();
  const { data: s } = await sb.from('weight_suggestions').select('*').eq('id', id).maybeSingle();
  if (!s || s.status !== 'pending') throw new HttpError(404, 'Suggestion not found or already decided.');
  if (decision === 'reject') {
    must(await sb.from('weight_suggestions').update({ status: 'rejected', decided_at: new Date().toISOString() }).eq('id', id), 'reject');
    return { ok: true };
  }
  if (decision !== 'approve') throw new HttpError(400, 'decision must be approve or reject.');
  const { version, weights } = await loadActiveWeights(sb);
  const { data: top } = await sb.from('scoring_weights').select('version').order('version', { ascending: false }).limit(1);
  const next = (top?.[0]?.version ?? version) + 1;
  must(await sb.from('scoring_weights').update({ active: false }).eq('active', true), 'deactivate');
  must(
    await sb.from('scoring_weights').insert({ version: next, weights: { ...weights, [s.weight_key]: Number(s.suggested_value) }, note: `Approved: ${s.weight_key} ${s.current_value} to ${s.suggested_value} (${s.situation})`, active: true }),
    'new version',
  );
  must(await sb.from('weight_suggestions').update({ status: 'approved', decided_at: new Date().toISOString(), resulting_version: next }).eq('id', id), 'approve');
  return { version: next };
});
