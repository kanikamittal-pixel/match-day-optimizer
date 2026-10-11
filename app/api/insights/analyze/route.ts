import { handle } from '@/server/http';
import { must, requireUser } from '@/server/integrations/supabase';
import { evalRows, groupStats, MIN_N } from '@/server/services/insights';
import { loadActiveWeights } from '@/server/db/queries';
import { gemini, parseJson, S } from '@/server/integrations/gemini';

export const maxDuration = 60;

/** Pattern finder: Gemini only sees groups with >= 8 data points; otherwise the answer is "Too early to tell". */
export const POST = handle(async () => {
  const { sb } = await requireUser();
  const stats = groupStats(await evalRows(sb)).filter((s) => s.conclusive && Math.abs(s.bias) >= 2);
  if (!stats.length) return { message: 'Too early to tell. No situation has 8+ data points with a repeated miss yet.', created: 0 };

  const { weights } = await loadActiveWeights(sb);
  const schema = S.obj({
    suggestions: S.arr(S.obj({ situation: S.str, weight_key: S.str, suggested_value: S.num })),
  });
  const { text } = await gemini({
    schema,
    temperature: 0.1,
    prompt: `You tune a Dream11 expected-points model. Bias = predicted minus actual points per player (positive = the model overrates).
SITUATIONS WITH >= ${MIN_N} DATA POINTS:
${stats.map((s) => `- "${s.dimension}: ${s.label}" n=${s.n} bias=${s.bias.toFixed(1)} mae=${s.mae.toFixed(1)}`).join('\n')}
CURRENT WEIGHTS: ${JSON.stringify(weights)}
Suggest at most 3 specific weight changes. "situation" must copy one of the quoted situations exactly. "weight_key" must be an existing key. Change a value by at most 25% of its current value. Only suggest a change when the evidence clearly points that way.`,
  });
  const out = parseJson<{ suggestions: { situation: string; weight_key: string; suggested_value: number }[] }>(text);

  const pending = must(await sb.from('weight_suggestions').select('weight_key,situation').eq('status', 'pending'), 'pending') as any[];
  const rows: any[] = [];
  for (const s of out.suggestions ?? []) {
    const stat = stats.find((x) => `${x.dimension}: ${x.label}` === s.situation);
    const cur = weights[s.weight_key];
    if (!stat || cur === undefined || !Number.isFinite(s.suggested_value)) continue; // evidence must be real
    if (Math.abs(s.suggested_value - cur) > Math.abs(cur) * 0.25 + 1e-9) continue;
    if (s.suggested_value === cur) continue;
    if (pending.some((p) => p.weight_key === s.weight_key && p.situation === s.situation)) continue;
    rows.push({
      weight_key: s.weight_key,
      current_value: cur,
      suggested_value: Math.round(s.suggested_value * 1000) / 1000,
      situation: s.situation,
      evidence: { n: stat.n, bias: Math.round(stat.bias * 10) / 10, mae: Math.round(stat.mae * 10) / 10, summary: `${stat.n} players, model ${stat.bias > 0 ? 'overrated' : 'underrated'} by ${Math.abs(stat.bias).toFixed(1)} pts on average` },
    });
  }
  if (rows.length) must(await sb.from('weight_suggestions').insert(rows), 'save suggestions');
  return { created: rows.length, message: rows.length ? `${rows.length} suggestion(s) waiting for your approval.` : 'Gemini found nothing worth changing.' };
});
