import { handle, HttpError } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { cricket, findCricketMatch, TTL } from '@/backend/integrations/cricketdata';
import { loadCredits, loadMatch } from '@/backend/db/queries';
import { aggregatesFromScorecard, pointsFromScorecard } from '@/backend/services/scorecard';
import { pointsFromWeb } from '@/backend/services/webscorecard';
import { mapAnnounced, matchName, sameShortName } from '@/shared/names';

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
  if (hit?.id) return hit.id;
  return findCricketMatch(sb, m.team_a, m.team_b, m.starts_at); // not in our list: ask CricketData's own score list
}

/** Fetch the scorecard and estimate Dream11 points for the players on Aryan's results list. */
export const POST = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const m = await loadMatch(sb, id);
  if (m.starts_at && new Date(m.starts_at).getTime() > Date.now()) throw new HttpError(409, 'This match has not started yet, so there is no result to fetch. Come back once it has started.');
  const cid = await scorecardId(sb, id, m);
  if (!cid) {
    // No cricket API has this match: read a public scorecard instead, clearly labelled so Aryan checks it
    const credits0 = await loadCredits(sb, id);
    const preds0 = must(await sb.from('predictions').select('name_key,player_name,role').eq('match_id', id), 'predictions') as { name_key: string; player_name: string; role: string }[];
    try {
      const { data: nr } = await sb.from('api_cache').select('payload').eq('key', `names:${id}`).maybeSingle();
      const fullName = (nr?.payload?.names ?? {}) as Record<string, string>; // spelled-out names saved with the announced XI
      const web = await pointsFromWeb(m, preds0.map((p) => ({ key: p.name_key, name: fullName[p.name_key] ?? credits0.find((c) => c.name_key === p.name_key)?.name ?? p.player_name, role: p.role })));
      if (web.matched >= 8) return { points: web.points, matched: web.matched, unmatched: web.dropped, final: web.final, status: web.status, source: 'web', sources: web.sources };
    } catch { /* fall through to manual entry */ }
    throw new HttpError(404, 'No scorecard source found for this match (and no public scorecard could be read), so results can’t be fetched. Enter the points by hand.', { manual: true });
  }

  const sc = await cricket<any>(sb, 'match_scorecard', { id: cid }, TTL.scorecard, false, true);
  const d = sc.data.data ?? {};
  if (!d.scorecard?.length) throw new HttpError(409, d.matchStarted ? 'The scorecard is empty so far. Try again once the match has progressed.' : 'The match hasn’t started yet, so there are no results to fetch.');

  const credits = await loadCredits(sb, id);
  const roleByKey = new Map(credits.map((c) => [c.name_key, c.role]));
  const preds = must(await sb.from('predictions').select('name_key,player_name').eq('match_id', id), 'predictions') as { name_key: string; player_name: string }[];
  const known = preds.map((p) => ({ key: p.name_key, name: p.player_name }));
  // Link each scorecard name (full names) to our list (short Dream11 names), most exact first:
  //  1. the spelled-out names saved when the announced XI was fetched, 2. the strict full-name matcher, 3. the old matcher.
  const { data: namesRow } = await sb.from('api_cache').select('payload').eq('key', `names:${id}`).maybeSingle();
  const byFull = new Map<string, string>(Object.entries((namesRow?.payload?.names ?? {}) as Record<string, string>).map(([k, n]) => [norm(n), k]));
  const scoreNames = [...aggregatesFromScorecard(d.scorecard).keys()];
  // two squad players with the same short name ("K Mendis" twice) cannot be told apart by the matcher: leave them for the saved names or a person
  const twins = new Set(known.filter((a) => known.some((b) => b.key !== a.key && sameShortName(a.name, b.name))).map((a) => a.key));
  const strict = mapAnnounced(scoreNames.filter((n) => !byFull.has(norm(n))), known.filter((k) => !twins.has(k.key)));
  const viaStrict = new Map(strict.pairs.map((x) => [x.announced, x.key]));
  // a saved full name that is part of a longer scorecard name ("Mohammad Imran" in "Mohammad Imran Randhawa"), when only one fits
  const words = (n: string) => n.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
  const viaSubset = (name: string): string | null => {
    const nw = words(name);
    const hits = Object.entries((namesRow?.payload?.names ?? {}) as Record<string, string>).filter(([, full]) => { const fw = words(full); return fw.length >= 2 && fw.every((w) => nw.includes(w)); });
    return hits.length === 1 ? hits[0][0] : null;
  };
  const keyFor = (name: string): string | null => byFull.get(norm(name)) ?? viaSubset(name) ?? viaStrict.get(name) ?? matchName(name, known.filter((k) => !twins.has(k.key)));
  const roleOf = (name: string) => {
    const k = keyFor(name);
    return k ? roleByKey.get(k) : undefined;
  };
  const scored = pointsFromScorecard(d.scorecard, roleOf, { estimateDots: true });
  const points: Record<string, number> = {};
  const unmatched: string[] = [];
  for (const s of scored) {
    const key = keyFor(s.name);
    if (key) points[key] = s.points;
    else unmatched.push(s.name);
  }
  return { points, matched: Object.keys(points).length, unmatched, final: !!d.matchEnded, status: d.status ?? null, source: 'cricketdata' };
});
