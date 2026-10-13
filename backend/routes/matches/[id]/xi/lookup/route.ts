import { handle } from '@/backend/http';
import { requireUser } from '@/backend/integrations/supabase';
import { loadCredits, loadMatch } from '@/backend/db/queries';
import { lookupAnnouncedXI } from '@/backend/services/lookup';
import { mapAnnounced } from '@/shared/names';

/** Try to fetch the announced XI automatically and map it onto the confirmed player table. */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const m = await loadMatch(sb, id);
  const credits = await loadCredits(sb, id);
  const found = await lookupAnnouncedXI(m);
  if (!found.announced) return { announced: false, note: found.note, sources: found.sources };

  const poolOf = (team: string) => credits.filter((c) => c.team === team).map((c) => ({ key: c.name_key, name: c.name }));
  const a = mapAnnounced(found.team_a_xi, poolOf(m.team_a));
  const b = mapAnnounced(found.team_b_xi, poolOf(m.team_b));
  const imp = mapAnnounced(found.impact_subs, credits.map((c) => ({ key: c.name_key, name: c.name })));
  return {
    announced: true,
    note: found.note,
    sources: found.sources,
    teamA: a.keys,
    teamB: b.keys,
    impact: imp.keys,
    unmatched: [...a.unmatched, ...b.unmatched],
    guessed: [...a.guessed, ...b.guessed],
  };
});
