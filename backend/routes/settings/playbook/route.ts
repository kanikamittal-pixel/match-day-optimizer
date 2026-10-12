import { handle, HttpError } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';

export const GET = handle(async () => {
  const { sb } = await requireUser();
  return { rules: must(await sb.from('playbook_rules').select('*').order('created_at', { ascending: false }), 'playbook') };
});

/** Playbook rules and "mix" rules (owner per situation) are only ever added by Aryan pressing a button. */
export const POST = handle(async (req: Request) => {
  const { sb } = await requireUser();
  const b = await req.json();
  if (!b.situation?.trim() || !b.rule?.trim()) throw new HttpError(400, 'Situation and rule are both required.');
  const { data: last } = await sb.from('playbook_rules').select('version').order('version', { ascending: false }).limit(1);
  const version = (last?.[0]?.version ?? 0) + 1;
  must(await sb.from('playbook_rules').insert({ version, situation: b.situation.trim(), rule: b.rule.trim(), owner: b.owner === 'aryan' ? 'aryan' : 'agent' }), 'add rule');
  return { version };
});

export const PATCH = handle(async (req: Request) => {
  const { sb } = await requireUser();
  const b = await req.json();
  const patch: Record<string, unknown> = {};
  if (typeof b.active === 'boolean') {
    patch.active = b.active;
    patch.retired_at = b.active ? null : new Date().toISOString();
  }
  if (b.owner === 'agent' || b.owner === 'aryan') patch.owner = b.owner;
  must(await sb.from('playbook_rules').update(patch).eq('id', b.id), 'update rule');
  return { ok: true };
});
