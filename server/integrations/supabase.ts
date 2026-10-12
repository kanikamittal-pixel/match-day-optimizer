import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { HttpError } from '@/server/http';

export async function supabaseServer(): Promise<SupabaseClient> {
  const store = await cookies();
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new HttpError(500, 'SUPABASE_URL / SUPABASE_ANON_KEY are not set.');
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list: { name: string; value: string; options: any }[]) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          /* called from a read-only context; middleware refreshes the session */
        }
      },
    },
  });
}

export async function requireUser(): Promise<{ sb: SupabaseClient; user: User }> {
  const sb = await supabaseServer();
  // Open-access mode (reviewer demo): no login, the database is reached as the anon role.
  if (process.env.OPEN_ACCESS === 'true') return { sb, user: { id: 'open-access' } as User };
  const { data } = await sb.auth.getUser();
  if (!data.user) throw new HttpError(401, 'Not signed in.');
  return { sb, user: data.user };
}

export function must<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) throw new HttpError(500, `${what}: ${res.error.message}`);
  return res.data as NonNullable<T>;
}
