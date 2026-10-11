import { handle } from '@/lib/http';
import { supabaseServer } from '@/lib/supabase/server';

export const POST = handle(async () => {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  return { ok: true };
});
