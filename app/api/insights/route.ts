import { handle } from '@/server/http';
import { must, requireUser } from '@/server/integrations/supabase';
import { errorOverTime, evalRows, groupStats, MIN_N, plainFindings, playbookNudges, scoreboardAndCvc } from '@/server/services/insights';

export const GET = handle(async () => {
  const { sb } = await requireUser();
  const rows = await evalRows(sb);
  const stats = groupStats(rows);
  const board = await scoreboardAndCvc(sb);
  const matchesScored = new Set(rows.map((r) => r.match_id)).size;
  return {
    minN: MIN_N,
    matchesScored,
    playersScored: rows.length,
    overTime: errorOverTime(rows),
    findings: plainFindings(stats),
    tooEarly: stats.filter((s) => !s.conclusive && ['venue', 'role on pitch type', 'position on pitch type'].includes(s.dimension)).slice(0, 8),
    groups: stats.filter((s) => s.conclusive),
    ...board,
    nudges: await playbookNudges(sb),
    suggestions: must(await sb.from('weight_suggestions').select('*').eq('status', 'pending').order('created_at', { ascending: false }), 'suggestions'),
  };
});
