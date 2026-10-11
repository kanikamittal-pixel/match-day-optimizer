import { handle, HttpError } from '@/lib/http';
import { must, requireUser } from '@/lib/supabase/server';
import { loadRules } from '@/lib/data';
import { ROLES } from '@/lib/types';

export const GET = handle(async () => {
  const { sb } = await requireUser();
  return { rules: await loadRules(sb) };
});

export const PUT = handle(async (req: Request) => {
  const { sb } = await requireUser();
  const r = await req.json();
  const num = (v: unknown, name: string, min: number, max: number) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} is out of range.`);
    return n;
  };
  const next = {
    credit_cap: num(r.credit_cap, 'Credit cap', 50, 200),
    team_size: num(r.team_size, 'Team size', 5, 15),
    max_per_team: num(r.max_per_team, 'Max per team', 1, 15),
    captain_mult: num(r.captain_mult, 'Captain multiplier', 1, 5),
    vc_mult: num(r.vc_mult, 'Vice-captain multiplier', 1, 5),
    role_min: {} as Record<string, number>,
    role_max: {} as Record<string, number>,
  };
  for (const role of ROLES) {
    next.role_min[role] = num(r.role_min?.[role], `${role} min`, 0, 11);
    next.role_max[role] = num(r.role_max?.[role], `${role} max`, 0, 11);
    if (next.role_min[role] > next.role_max[role]) throw new HttpError(400, `${role}: min is above max.`);
  }
  const minSum = ROLES.reduce((s, x) => s + next.role_min[x], 0);
  const maxSum = ROLES.reduce((s, x) => s + next.role_max[x], 0);
  if (minSum > next.team_size || maxSum < next.team_size) throw new HttpError(400, 'Role limits cannot add up to the team size.');
  must(await sb.from('rules_config').update({ ...next, updated_at: new Date().toISOString() }).eq('id', 1), 'save rules');
  return { ok: true };
});
