import { handle } from '@/lib/http';
import { must, requireUser } from '@/lib/supabase/server';
import { loadMatch } from '@/lib/data';
import { fetchConditions } from '@/lib/pipeline';

export const maxDuration = 60;

/** Gemini + Google Search conditions. Cached on the match for 3h unless forced. */
export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const m = await loadMatch(sb, id);
  const force = new URL(req.url).searchParams.get('force') === '1';
  const fresh = m.context_fetched_at && Date.now() - new Date(m.context_fetched_at).getTime() < 3 * 3600 * 1000;
  if (m.context && fresh && !force) return { context: m.context, cached: true };
  const context = await fetchConditions(m);
  must(await sb.from('matches').update({ context, context_fetched_at: new Date().toISOString() }).eq('id', id), 'save context');
  return { context, cached: false };
});
