/**
 * Estimates Dream11 fantasy points from a CricketData scorecard, using the approved scoring weights.
 * This is an ESTIMATE: Dream11's official numbers include things the scorecard lacks (direct vs indirect
 * run-outs, strike-rate bonuses for some formats), so Aryan reviews and edits before saving.
 */
export interface PlayerPoints {
  name: string;
  points: number;
}

const WICKET_KINDS = /(bowled|lbw|catch|caught|stump|hit.?wicket)/i;
const BOWLER_BONUS = /(bowled|lbw)/i;

function econBonus(eco: number, overs: number, format: string): number {
  if (format !== 'T20' || overs < 2) return 0;
  if (eco < 5) return 6;
  if (eco < 6) return 4;
  if (eco <= 7) return 2;
  if (eco >= 10 && eco < 11) return -2;
  if (eco >= 11 && eco <= 12) return -4;
  if (eco > 12) return -6;
  return 0;
}

export function pointsFromScorecard(scorecard: any[], w: Record<string, number>, format = 'T20'): PlayerPoints[] {
  const acc = new Map<string, { name: string; pts: number; catches: number; wkts: number }>();
  const get = (name: string) => {
    const k = name.toLowerCase();
    if (!acc.has(k)) acc.set(k, { name, pts: w.in_xi ?? 4, catches: 0, wkts: 0 }); // appearing in the scorecard = played
    return acc.get(k)!;
  };

  for (const inn of scorecard ?? []) {
    for (const b of inn.batting ?? []) {
      const name = b.batsman?.name;
      if (!name) continue;
      const p = get(name);
      const runs = Number(b.r ?? 0);
      const text = String(b['dismissal-text'] ?? b.dismissal ?? '');
      const out = !!b.dismissal || (text !== '' && !/not out|retired|did not bat|dnb/i.test(text));
      p.pts += runs * (w.run ?? 1) + Number(b['4s'] ?? 0) * (w.boundary_bonus ?? 1) + Number(b['6s'] ?? 0) * (w.six_bonus ?? 2);
      p.pts += runs >= 100 ? (w.bonus_100 ?? 16) : runs >= 50 ? (w.bonus_50 ?? 8) : runs >= 25 ? (w.bonus_25 ?? 4) : 0;
      if (out && runs === 0) p.pts += w.duck ?? -2;
      // wicket credit goes to the bowler (not for run-outs)
      const bowler = b.bowler?.name;
      if (bowler && WICKET_KINDS.test(String(b.dismissal ?? text))) {
        const bw = get(bowler);
        bw.wkts += 1;
        bw.pts += w.wicket ?? 25;
        if (BOWLER_BONUS.test(String(b.dismissal ?? text))) bw.pts += w.lbw_bowled_bonus ?? 8;
      }
    }
    for (const bo of inn.bowling ?? []) {
      const name = bo.bowler?.name;
      if (!name) continue;
      const p = get(name);
      p.pts += Number(bo.m ?? 0) * (w.maiden ?? 12) + econBonus(Number(bo.eco ?? 0), Number(bo.o ?? 0), format);
    }
    for (const c of inn.catching ?? []) {
      const name = c.catcher?.name;
      if (!name) continue;
      const p = get(name);
      const catches = Number(c.catch ?? 0);
      p.catches += catches;
      p.pts += catches * (w.catch ?? 8) + Number(c.stumped ?? 0) * (w.stumping ?? 12) + Number(c.runout ?? 0) * (w.run_out_direct ?? 12);
    }
  }
  return [...acc.values()].map((p) => {
    let pts = p.pts;
    if (p.catches >= 3) pts += 4; // 3-catch bonus
    if (p.wkts >= 5) pts += w.bonus_5_wkts ?? 16;
    else if (p.wkts >= 3) pts += w.bonus_3_wkts ?? 4;
    return { name: p.name, points: Math.round(pts * 2) / 2 };
  });
}
