import { handle } from '@/backend/http';
import { supabaseServer } from '@/backend/integrations/supabase';

export const POST = handle(async () => {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  return { ok: true };
});
