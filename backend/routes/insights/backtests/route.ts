import { handle } from '@/backend/http';
import { requireUser } from '@/backend/integrations/supabase';
import { buildChanges } from '@/backend/services/backtest-notes';

/** Back-tests of finished matches, the large formula comparison, and the log of what was changed and why. */
export const GET = handle(async () => {
  const { sb } = await requireUser();
  const { data } = await sb.from('api_cache').select('key,payload').like('key', 'bt:%');
  const rows = (data ?? []) as { key: string; payload: any }[];
  const formulas = rows.find((r) => r.key === 'bt:formulas')?.payload ?? null;
  const audit = rows.find((r) => r.key === 'bt:audit')?.payload ?? null;
  const records = rows.filter((r) => /^bt:[^:]+:v\d+$/.test(r.key)).map((r) => r.payload);
  // group by match, newest logic first
  const byRef = new Map<string, any[]>();
  for (const r of records) byRef.set(r.ref, [...(byRef.get(r.ref) ?? []), r]);
  const matches = [...byRef.values()]
    .map((list) => list.sort((a, b) => String(b.logic).localeCompare(String(a.logic))))
    .sort((a, b) => String(b[0].date).localeCompare(String(a[0].date)));
  return { matches, formulas, audit, changes: formulas ? buildChanges(formulas, records, rows.filter((r) => r.key.startsWith('bt:stability:'))) : [] };
});
