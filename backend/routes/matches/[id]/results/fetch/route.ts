import { handle, HttpError } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { cricket, TTL } from '@/backend/integrations/cricketdata';
import { loadCredits, loadMatch } from '@/backend/db/queries';
import { pointsFromScorecard } from '@/backend/services/scorecard';
import { matchName } from '@/shared/names';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Find the CricketData id for this match (matches that came from RapidAPI are looked up by teams + day). */
async function scorecardId(sb: any, id: string, m: { team_a: string; team_b: string; starts_at: string | null }): Promise<string | null> {
  if (!id.startsWith('rb-') && !id.startsWith('manual-')) return id;
  if (!m.starts_at) return null;
  const t = new Date(m.starts_at).getTime();
  const { data } = await sb.from('matches').select('id,team_a,team_b,starts_at').not('id', 'like', 'rb-%').not('id', 'like', 'manual-%');
  const hit = (data ?? []).find((x: any) => {
    const same = (norm(x.team_a) === norm(m.team_a) && norm(x.team_b) === norm(m.team_b)) || (norm(x.team_a) === norm(m.team_b) && norm(x.team_b) === norm(m.team_a));
    return same && Math.abs(new Date(x.starts_at).getTime() - t) < 36 * 3600 * 1000;
  });
  return hit?.id ?? null;
}

/** Fetch the scorecard and estimate Dream11 points for the players on Aryan's results list. */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const m = await loadMatch(sb, id);
  const cid = await scorecardId(sb, id, m);
  if (!cid) throw new HttpError(404, 'No scorecard source found for this match, so results can’t be fetched. Enter the points by hand.', { manual: true });

  const sc = await cricket<any>(sb, 'match_scorecard', { id: cid }, TTL.scorecard, false, true);
  const d = sc.data.data ?? {};
  if (!d.scorecard?.length) throw new HttpError(409, d.matchStarted ? 'The scorecard is empty so far. Try again once the match has progressed.' : 'The match hasn’t started yet, so there are no results to fetch.');

  const credits = await loadCredits(sb, id);
  const roleByKey = new Map(credits.map((c) => [c.name_key, c.role]));
  const preds = must(await sb.from('predictions').select('name_key,player_name').eq('match_id', id), 'predictions') as { name_key: string; player_name: string }[];
  const known = preds.map((p) => ({ key: p.name_key, name: p.player_name }));
  const roleOf = (name: string) => {
    const k = matchName(name, known);
    return k ? roleByKey.get(k) : undefined;
  };
  const scored = pointsFromScorecard(d.scorecard, roleOf, { estimateDots: true });
  const points: Record<string, number> = {};
  const unmatched: string[] = [];
  for (const s of scored) {
    const key = matchName(s.name, known);
    if (key) points[key] = s.points;
    else unmatched.push(s.name);
  }
  return { points, matched: Object.keys(points).length, unmatched, final: !!d.matchEnded, status: d.status ?? null };
});
