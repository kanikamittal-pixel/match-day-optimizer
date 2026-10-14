import { gemini, parseJson } from '@/backend/integrations/gemini';
import { emptyAgg, scoreAgg, type Agg, type ScoreRole } from '@/shared/scoring';
import { mapAnnounced, sameShortName } from '@/shared/names';

interface WebPlayer { name: string; played: boolean; runs: number; balls: number; fours: number; sixes: number; out: boolean; overs: number; maidens: number; runs_conceded: number; wickets: number; lbw_or_bowled: number; catches: number; stumpings: number; run_outs: number }

const RUNS_PER_SCORING_BALL = 2.1; // the same dot-ball estimate the scorecard route uses

/** Is a row believable for a T20 or ODI player? Anything else means the page was misread and the row is dropped. */
export function plausible(p: WebPlayer, format: string): boolean {
  const maxOvers = format === 'ODI' ? 10 : 4;
  const n = (x: unknown) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  return [p.runs, p.balls, p.fours, p.sixes, p.overs, p.maidens, p.runs_conceded, p.wickets, p.lbw_or_bowled, p.catches, p.stumpings, p.run_outs].every(n)
    && p.runs <= 300 && p.balls <= 150 && p.fours + p.sixes <= p.balls && p.overs <= maxOvers && p.wickets <= 10 && p.lbw_or_bowled <= p.wickets && p.maidens <= p.overs && p.catches <= 6 && p.runs_conceded <= 150;
}

function toAgg(p: WebPlayer): Agg {
  const a = emptyAgg();
  a.played = p.played;
  a.runs = p.runs; a.balls = p.balls; a.fours = p.fours; a.sixes = p.sixes; a.out = p.out;
  a.ballsBowled = Math.floor(p.overs) * 6 + Math.round((p.overs % 1) * 10);
  a.runsConceded = p.runs_conceded; a.maidens = p.maidens; a.wickets = p.wickets; a.lbwBowled = p.lbw_or_bowled;
  a.dots = Math.max(0, Math.min(a.ballsBowled, Math.round(a.ballsBowled - a.runsConceded / RUNS_PER_SCORING_BALL)));
  a.catches = p.catches; a.stumpings = p.stumpings; a.runOutsDirect = p.run_outs;
  return a;
}

/**
 * Fallback when no cricket API has the scorecard: ask the model to read a public scorecard (Google Search) for the players
 * on the list, then score them with the app's own Dream11 table. Reading a web page can go wrong, so rows that are not
 * believable are dropped, and the caller labels the result as needing a check.
 */
export async function pointsFromWeb(
  m: { team_a: string; team_b: string; venue: string | null; format: string | null; starts_at: string | null },
  players: { key: string; name: string; role: string }[],
): Promise<{ points: Record<string, number>; matched: number; final: boolean; status: string | null; sources: { title: string; uri: string }[]; dropped: string[] }> {
  const list = players.map((p) => p.name).join(', ');
  const { text, sources } = await gemini({
    grounding: true,
    temperature: 0,
    prompt: `Use Google Search to find the FULL scorecard of this cricket match: ${m.team_a} vs ${m.team_b}, ${m.format ?? 'T20'}, ${m.venue ?? ''}, played on ${(m.starts_at ?? '').slice(0, 10)}. Read it from a scorecard page (ESPNcricinfo, Cricbuzz, Dawn, etc.), not from a summary article.
For every player who appears in the scorecard, report what they did. Reply with ONLY a JSON object:
{"finished": boolean, "result": "result line or null", "players": [{"name": "full name as on the scorecard", "played": true, "runs": 0, "balls": 0, "fours": 0, "sixes": 0, "out": false, "overs": 0, "maidens": 0, "runs_conceded": 0, "wickets": 0, "lbw_or_bowled": 0, "catches": 0, "stumpings": 0, "run_outs": 0}]}
Rules: overs in cricket notation (3.4 means 3 overs and 4 balls). "out" is true if the batter was dismissed. "lbw_or_bowled" counts that bowler's wickets that were LBW or bowled. "catches" counts catches taken by that player as a fielder (a wicketkeeper's catches included); use 0 if the scorecard does not name the fielder. A player who did not bat or bowl but was in the XI still gets played true with zeros. Do not invent anything; if no scorecard can be found set finished to false and players to []. For reference, the players I care about are: ${list}.`,
  });
  const j = parseJson<{ finished?: boolean; result?: string | null; players?: WebPlayer[] }>(text);
  const format = m.format ?? 'T20';
  const dropped: string[] = [];
  const good = (j.players ?? []).filter((p) => { const ok = !!p?.name && plausible(p, format); if (!ok && p?.name) dropped.push(p.name); return ok; });
  const roleOf = new Map(players.map((p) => [p.key, p.role as ScoreRole]));
  // two squad players that cannot be told apart by name ("K Mendis" twice) are left out rather than risk swapping their points
  const first = (n: string) => (n.replace(/\(.*?\)/g, '').trim().split(/\s+/)[0] ?? '').toLowerCase();
  const twin = (a: string, b: string) => sameShortName(a, b) && (first(a).length < 3 || first(b).length < 3 || first(a).startsWith(first(b)) || first(b).startsWith(first(a)));
  const pool = players.filter((a) => !players.some((b) => b.key !== a.key && twin(a.name, b.name)));
  const mapped = mapAnnounced(good.map((p) => p.name), pool.map((p) => ({ key: p.key, name: p.name })));
  const points: Record<string, number> = {};
  for (const pr of mapped.pairs) {
    const row = good.find((g) => g.name === pr.announced)!;
    points[pr.key] = Math.round(scoreAgg(toAgg(row), roleOf.get(pr.key)) * 2) / 2;
  }
  return { points, matched: Object.keys(points).length, final: !!j.finished, status: j.result ?? null, sources, dropped };
}
