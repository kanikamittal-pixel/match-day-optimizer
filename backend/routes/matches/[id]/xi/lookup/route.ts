import { handle } from '@/backend/http';
import { requireUser } from '@/backend/integrations/supabase';
import { loadCredits, loadMatch } from '@/backend/db/queries';
import { lookupAnnouncedXI } from '@/backend/services/lookup';
import { matchName } from '@/shared/names';

/** Try to fetch the announced XI automatically and map it onto the confirmed player table. */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const m = await loadMatch(sb, id);
  const credits = await loadCredits(sb, id);
  const known = credits.map((c) => ({ key: c.name_key, name: c.name }));
  const found = await lookupAnnouncedXI(m);
  if (!found.announced) return { announced: false, note: found.note, sources: found.sources };

  const unmatched: string[] = [];
  const map = (names: string[], team: string) =>
    names
      .map((n) => {
        const key = matchName(n, known.filter((k) => credits.find((c) => c.name_key === k.key)?.team === team));
        if (!key) unmatched.push(n);
        return key;
      })
      .filter((k): k is string => !!k);
  const impact = found.impact_subs.map((n) => matchName(n, known)).filter((k): k is string => !!k);
  return {
    announced: true,
    note: found.note,
    sources: found.sources,
    teamA: map(found.team_a_xi, m.team_a),
    teamB: map(found.team_b_xi, m.team_b),
    impact,
    unmatched,
  };
});
