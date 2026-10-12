import { spearman } from './stats';

/** One player in one match, with what the agent expected and what happened. */
export interface RPlayer {
  name: string;
  team: string;
  role: string;
  batPos: number | null;
  predicted: number | null; // the agent's expected points; null when the player was not in the agent's list
  base: number | null; // history-only number behind the prediction
  adjustment: number | null; // pitch and conditions adjustment
  actual: number;
  baseline: number | null; // plain last-5 average
  reason: string | null;
  played: boolean; // false: in the agent's team but did not play (scores 0)
  inOurXI: boolean;
  inTop11: boolean;
}

export interface Team { xi: string[]; captain: string; vc: string }

const r1 = (n: number) => Math.round(n * 10) / 10;
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
export const posBucket = (pos: number | null) => (!pos ? 'did not bat' : pos <= 2 ? 'openers (1-2)' : pos <= 4 ? 'top order (3-4)' : pos <= 6 ? 'middle order (5-6)' : 'lower order (7+)');
const BUCKETS = ['openers (1-2)', 'top order (3-4)', 'middle order (5-6)', 'lower order (7+)', 'did not bat'];
const ROLES = ['WK', 'BAT', 'AR', 'BOWL'];

const teamScore = (by: Map<string, RPlayer>, t: Team, cm: number, vm: number) => r1(t.xi.reduce((s, n) => s + (by.get(n)?.actual ?? 0) * (n === t.captain ? cm : n === t.vc ? vm : 1), 0));

export interface MatchReport {
  headline: {
    ourPoints: number; topPoints: number; baselinePoints: number | null; pctOfTop: number; overlap: number; size: number;
    captain: { name: string; points: number; rank: number; of: number; bestInOurXI: { name: string; points: number } };
    vc: { name: string; points: number; rank: number };
    spearman: number | null; mae: number | null; maeBaseline: number | null;
  };
  ours: (RPlayer & { badge: 'C' | 'VC' | null; counted: number })[];
  top11: (RPlayer & { badge: 'C' | 'VC' | null; counted: number })[];
  missed: (RPlayer & { ourRank: number | null; why: string })[];
  flops: (RPlayer & { why: string })[];
  byRole: { role: string; ourN: number; ourPts: number; topN: number; topPts: number }[];
  byPosition: { bucket: string; ourN: number; ourPts: number; topN: number; topPts: number }[];
  lags: string[];
  everyone: RPlayer[];
}

/**
 * Everything about ONE match: our team against the real top 11, the key metrics, and in plain words what we missed.
 * Top 11 is the best valid team in hindsight (same role and team limits), passed in by the caller.
 */
export function matchReport(players: RPlayer[], ours: Team, top: Team, baseline: Team | null, mult = { c: 2, vc: 1.5 }): MatchReport {
  const by = new Map(players.map((p) => [p.name, p]));
  const flagged = players.map((p) => ({ ...p, inOurXI: ours.xi.includes(p.name), inTop11: top.xi.includes(p.name) }));
  const fby = new Map(flagged.map((p) => [p.name, p]));
  const badge = (t: Team, n: string): 'C' | 'VC' | null => (n === t.captain ? 'C' : n === t.vc ? 'VC' : null);
  const counted = (t: Team, p: RPlayer) => r1(p.actual * (p.name === t.captain ? mult.c : p.name === t.vc ? mult.vc : 1));
  const oursP = ours.xi.map((n) => fby.get(n)).filter((p): p is RPlayer => !!p).sort((a, b) => b.actual - a.actual);
  const topP = top.xi.map((n) => fby.get(n)).filter((p): p is RPlayer => !!p).sort((a, b) => b.actual - a.actual);
  const everyone = [...flagged].sort((a, b) => b.actual - a.actual);
  const playedOnly = everyone.filter((p) => p.played);
  const rankOfActual = (n: string) => 1 + playedOnly.findIndex((p) => p.name === n);

  const ourPoints = teamScore(by, ours, mult.c, mult.vc), topPoints = teamScore(by, top, mult.c, mult.vc);
  const baselinePoints = baseline ? teamScore(by, baseline, mult.c, mult.vc) : null;
  const predicted = playedOnly.filter((p) => p.predicted !== null);
  const predRank = (n: string) => { const i = [...predicted].sort((a, b) => (b.predicted as number) - (a.predicted as number)).findIndex((p) => p.name === n); return i < 0 ? null : i + 1; };
  const withBase = playedOnly.filter((p) => p.baseline !== null && p.predicted !== null);
  const sp = predicted.length >= 5 ? spearman(predicted.map((p) => p.predicted as number), predicted.map((p) => p.actual)) : null;
  const bestOurs = [...oursP].sort((a, b) => b.actual - a.actual)[0];
  const cap = fby.get(ours.captain), vcp = fby.get(ours.vc);

  const headline = {
    ourPoints, topPoints, baselinePoints, pctOfTop: topPoints ? Math.round((ourPoints / topPoints) * 100) : 0,
    overlap: ours.xi.filter((n) => top.xi.includes(n)).length, size: ours.xi.length,
    captain: { name: ours.captain, points: cap?.actual ?? 0, rank: rankOfActual(ours.captain), of: playedOnly.length, bestInOurXI: { name: bestOurs?.name ?? '', points: bestOurs?.actual ?? 0 } },
    vc: { name: ours.vc, points: vcp?.actual ?? 0, rank: rankOfActual(ours.vc) },
    spearman: sp === null ? null : Math.round(sp * 100) / 100,
    mae: predicted.length ? r1(mean(predicted.map((p) => Math.abs((p.predicted as number) - p.actual))) as number) : null,
    maeBaseline: withBase.length ? r1(mean(withBase.map((p) => Math.abs((p.baseline as number) - p.actual))) as number) : null,
  };

  const why = (p: RPlayer, forMissed: boolean): string => {
    const bits: string[] = [];
    if (forMissed) {
      const rk = predRank(p.name);
      bits.push(p.predicted === null ? 'Not in the agent’s list.' : `Ranked #${rk} of ${predicted.length} (expected ${p.predicted}).`);
    } else bits.push(`Expected ${p.predicted}, scored ${p.actual}${p.played ? '' : ' (did not play)'}.`);
    bits.push(p.base === null ? 'No usable history.' : `History said ${r1(p.base)}.`);
    if (p.adjustment !== null && Math.abs(p.adjustment) >= 3) bits.push(`The pitch adjustment moved him ${p.adjustment > 0 ? '+' : ''}${r1(p.adjustment)}.`);
    bits.push(p.played ? (p.batPos ? `Batted ${p.batPos}.` : 'Did not bat.') : '');
    return bits.filter(Boolean).join(' ');
  };

  const missed = topP.filter((p) => !p.inOurXI).map((p) => ({ ...p, ourRank: predRank(p.name), why: why(p, true) }));
  const flops = oursP
    .filter((p) => !p.played || (p.predicted !== null && p.predicted - p.actual >= 20))
    .sort((a, b) => (b.predicted ?? 0) - b.actual - ((a.predicted ?? 0) - a.actual))
    .slice(0, 4)
    .map((p) => ({ ...p, why: why(p, false) }));

  const group = <K extends string>(keys: K[], f: (p: RPlayer) => K) => keys.map((k) => {
    const a = oursP.filter((p) => f(p) === k), b = topP.filter((p) => f(p) === k);
    return { k, ourN: a.length, ourPts: r1(a.reduce((s, p) => s + p.actual, 0)), topN: b.length, topPts: r1(b.reduce((s, p) => s + p.actual, 0)) };
  });
  const byRole = group(ROLES, (p) => p.role).map(({ k, ...x }) => ({ role: k, ...x }));
  const byPosition = group(BUCKETS, (p) => posBucket(p.played ? p.batPos : null)).map(({ k, ...x }) => ({ bucket: k, ...x })).filter((x) => x.ourN || x.topN);

  // plain-language answer to "where did it lag?"
  const lags: string[] = [];
  lags.push(`${headline.overlap} of ${headline.size} picks were in the real top 11. Our team scored ${ourPoints} against ${topPoints} (${headline.pctOfTop}%).`);
  const cr = headline.captain.rank;
  if (cr > Math.ceil(headline.captain.of * 0.25)) lags.push(`The captain ${ours.captain} scored ${headline.captain.points}, only #${cr} of ${headline.captain.of}. ${headline.captain.bestInOurXI.name} in our own team scored ${headline.captain.bestInOurXI.points}; as captain that is worth ${r1((headline.captain.bestInOurXI.points - headline.captain.points) * (mult.c - 1))} more points.`);
  else lags.push(`The captain ${ours.captain} scored ${headline.captain.points}, #${cr} of ${headline.captain.of}: a good call.`);
  const noHist = missed.filter((m) => m.base === null);
  if (missed.length) lags.push(`${missed.length} of the top 11 were not picked${noHist.length ? `; ${noHist.length} of them had no usable history, which the agent cannot see` : ''}. The biggest miss: ${missed[0].name} (${missed[0].actual} points).`);
  const roleGap = byRole.map((r) => ({ role: r.role, d: r.topN - r.ourN })).filter((r) => Math.abs(r.d) >= 2).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  if (roleGap) lags.push(`Role mix: the real top 11 had ${byRole.find((r) => r.role === roleGap.role)!.topN} ${roleGap.role}, we picked ${byRole.find((r) => r.role === roleGap.role)!.ourN}.`);
  const posGap = byPosition.map((r) => ({ b: r.bucket, d: r.topN - r.ourN })).filter((r) => r.b !== 'did not bat' && Math.abs(r.d) >= 2).sort((a, b) => Math.abs(b.d) - Math.abs(a.d))[0];
  if (posGap) lags.push(`Batting order: the top 11 had ${byPosition.find((r) => r.bucket === posGap.b)!.topN} from the ${posGap.b}, we had ${byPosition.find((r) => r.bucket === posGap.b)!.ourN}.`);
  if (headline.mae !== null && headline.maeBaseline !== null) lags.push(`Average miss per player: ${headline.mae} points for the agent against ${headline.maeBaseline} for a plain last-5 average (${headline.mae <= headline.maeBaseline ? 'the agent was closer' : 'the plain average was closer'}).`);
  if (baselinePoints !== null) lags.push(`A plain last-5-average team would have scored ${baselinePoints}${baselinePoints > ourPoints ? ', more than ours' : ', less than ours'}.`);

  return {
    headline,
    ours: oursP.map((p) => ({ ...p, badge: badge(ours, p.name), counted: counted(ours, p) })),
    top11: topP.map((p) => ({ ...p, badge: badge(top, p.name), counted: counted(top, p) })),
    missed, flops, byRole, byPosition, lags, everyone,
  };
}
