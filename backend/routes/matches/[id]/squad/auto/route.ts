import { handle, HttpError } from '@/backend/http';
import { requireUser } from '@/backend/integrations/supabase';
import { loadMatch } from '@/backend/db/queries';
import { lookupSquad } from '@/backend/services/lookup';

export const maxDuration = 60;

/** Squad plus announced or probable XI for both teams from a web search. No screenshot needed; credits stay optional. */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const m = await loadMatch(sb, id);
  const f = await lookupSquad(m);
  const count = (t: 'A' | 'B') => f.players.filter((p) => p.team === t).length;
  if (count('A') < 11 || count('B') < 11) throw new HttpError(404, `Could not find both squads online yet (${f.note || 'no result'}). Paste them or add players by hand.`);
  return {
    announced: f.announced, note: f.note, sources: f.sources,
    rows: f.players.map((p) => ({ name: p.name, team: p.team === 'A' ? m.team_a : m.team_b, role: p.role, credit: '', inXI: p.inXI })),
  };
});
