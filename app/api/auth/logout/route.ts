import { handle } from '@/server/http';
import { supabaseServer } from '@/server/integrations/supabase';

export const POST = handle(async () => {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  return { ok: true };
});
