import { handle, HttpError } from '@/server/http';
import { supabaseServer } from '@/server/integrations/supabase';

export const POST = handle(async (req: Request) => {
  const { email, password } = await req.json();
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new HttpError(401, 'Wrong email or password.');
  return { ok: true };
});
