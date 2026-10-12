import { handle, HttpError } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { loadRules } from '@/backend/db/queries';
import { checkRules } from '@/shared/dream11';

export const GET = handle(async () => {
  const { sb } = await requireUser();
  return { rules: await loadRules(sb) };
});

export const PUT = handle(async (req: Request) => {
  const { sb } = await requireUser();
  const checked = checkRules(await req.json());
  if ('error' in checked) throw new HttpError(400, checked.error);
  const next = checked.rules;
  must(await sb.from('rules_config').update({ ...next, updated_at: new Date().toISOString() }).eq('id', 1), 'save rules');
  return { ok: true };
});
