import { handle, HttpError } from '@/server/http';
import { supabaseServer } from '@/server/integrations/supabase';

const enabled = () => process.env.DEMO_MODE === 'true' && !!process.env.DEMO_EMAIL && !!process.env.DEMO_PASSWORD;

/** One-tap sign-in for reviewers. Credentials stay server-side; turn off by unsetting DEMO_MODE. */
export const GET = handle(async () => ({ enabled: enabled() }));

export const POST = handle(async () => {
  if (!enabled()) throw new HttpError(404, 'Demo access is not enabled.');
  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email: process.env.DEMO_EMAIL!, password: process.env.DEMO_PASSWORD! });
  if (error) throw new HttpError(500, 'Demo account could not sign in. Check DEMO_EMAIL / DEMO_PASSWORD.');
  return { ok: true };
});
