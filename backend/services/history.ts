import type { SupabaseClient } from '@supabase/supabase-js';
import { must } from '@/backend/integrations/supabase';
import { summariseForm, type Form, type FormRow } from '@/shared/form';

/** Last-10 form for these players from every result Aryan has saved, excluding the match being predicted. */
export async function recentForm(sb: SupabaseClient, keys: string[], excludeMatchId?: string): Promise<Record<string, Form>> {
  if (!keys.length) return {};
  const acts = must(await sb.from('actual_points').select('match_id,name_key,points').in('name_key', keys), 'history') as { match_id: string; name_key: string; points: number }[];
  const rows = acts.filter((a) => a.match_id !== excludeMatchId);
  if (!rows.length) return {};
  const ids = [...new Set(rows.map((r) => r.match_id))];
  const ms = must(await sb.from('matches').select('id,starts_at,created_at').in('id', ids), 'history matches') as { id: string; starts_at: string | null; created_at: string }[];
  const when = new Map(ms.map((m) => [m.id, m.starts_at ?? m.created_at]));
  const fr: FormRow[] = rows.map((r) => ({ key: r.name_key, points: Number(r.points), when: when.get(r.match_id) ?? '' }));
  return summariseForm(fr);
}
