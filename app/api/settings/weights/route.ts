import { handle, HttpError } from '@/server/http';
import { must, requireUser } from '@/server/integrations/supabase';
import { ensureSeed } from '@/server/db/queries';

export const GET = handle(async () => {
  const { sb } = await requireUser();
  await ensureSeed(sb);
  const versions = must(await sb.from('scoring_weights').select('version,weights,note,active,created_at').order('version', { ascending: false }), 'weights');
  return { versions };
});

/** Roll back (or forward) by activating any earlier version. Nothing is ever deleted. */
export const POST = handle(async (req: Request) => {
  const { sb } = await requireUser();
  const { activate } = await req.json();
  const { data: v } = await sb.from('scoring_weights').select('version').eq('version', activate).maybeSingle();
  if (!v) throw new HttpError(404, 'Version not found.');
  must(await sb.from('scoring_weights').update({ active: false }).eq('active', true), 'deactivate');
  must(await sb.from('scoring_weights').update({ active: true }).eq('version', activate), 'activate');
  return { ok: true };
});
