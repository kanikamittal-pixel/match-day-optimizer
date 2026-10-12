import { emptyAgg, scoreAgg, type Agg, type ScoreRole } from '@/shared/scoring';

/**
 * Builds per-player match aggregates from a CricketData scorecard, then scores them with the Dream11 T20
 * table in shared/scoring.ts. This is an ESTIMATE: the scorecard has no dot balls and no direct/indirect
 * run-out split, so those are left out; Aryan reviews the numbers before saving.
 */
const WICKET_KINDS = /(bowled|lbw|catch|caught|stump|hit.?wicket)/i;
const BOWLER_BONUS = /(bowled|lbw)/i;
const legalBalls = (overs: number) => Math.floor(overs) * 6 + Math.round((overs - Math.floor(overs)) * 10);

export function aggregatesFromScorecard(scorecard: any[]): Map<string, Agg> {
  const acc = new Map<string, Agg>();
  const get = (name: string) => {
    const k = name.toLowerCase();
    if (!acc.has(k)) acc.set(k, { ...emptyAgg(), played: true });
    return { k, agg: acc.get(k)! };
  };
  const names = new Map<string, string>();
  const use = (name: string) => {
    const g = get(name);
    names.set(g.k, name);
    return g.agg;
  };

  for (const inn of scorecard ?? []) {
    for (const b of inn.batting ?? []) {
      const name = b.batsman?.name;
      if (!name) continue;
      const a = use(name);
      a.runs += Number(b.r ?? 0);
      a.balls += Number(b.b ?? 0);
      a.fours += Number(b['4s'] ?? 0);
      a.sixes += Number(b['6s'] ?? 0);
      const text = String(b['dismissal-text'] ?? b.dismissal ?? '');
      a.out = a.out || !!b.dismissal || (text !== '' && !/not out|retired|did not bat|dnb/i.test(text));
      const kind = String(b.dismissal ?? text);
      const bowler = b.bowler?.name;
      if (bowler && WICKET_KINDS.test(kind)) {
        const bw = use(bowler);
        bw.wickets += 1;
        if (BOWLER_BONUS.test(kind)) bw.lbwBowled += 1;
      }
    }
    for (const bo of inn.bowling ?? []) {
      const name = bo.bowler?.name;
      if (!name) continue;
      const a = use(name);
      a.ballsBowled += legalBalls(Number(bo.o ?? 0));
      a.runsConceded += Number(bo.r ?? 0);
      a.maidens += Number(bo.m ?? 0);
    }
    for (const c of inn.catching ?? []) {
      const name = c.catcher?.name;
      if (!name) continue;
      const a = use(name);
      a.catches += Number(c.catch ?? 0);
      a.stumpings += Number(c.stumped ?? 0);
      a.runOutsDirect += Number(c.runout ?? 0); // scorecard gives no direct/indirect split
    }
  }
  const out = new Map<string, Agg>();
  for (const [k, agg] of acc) out.set(names.get(k)!, agg);
  return out;
}

export interface PlayerPoints {
  name: string;
  points: number;
}

export function pointsFromScorecard(scorecard: any[], roleOf?: (name: string) => ScoreRole | undefined): PlayerPoints[] {
  return [...aggregatesFromScorecard(scorecard)].map(([name, agg]) => ({ name, points: Math.round(scoreAgg(agg, roleOf?.(name)) * 2) / 2 }));
}
