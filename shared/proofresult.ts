import { pairNames } from './names';

export interface Played { name: string; team: string; points: number }
export interface RecPick { name: string; role: string; team: string }
export interface ProofResult {
  source: string;
  playedCount: number;
  picks: { name: string; role: string; team: string; played: boolean; points: number | null; counted: number | null; badge: 'C' | 'VC' | null }[];
  didNotPlay: string[];
  total: number;
  bestPossible: number | null;
  /** all players who played, best first; picked = in the recommended XI */
  everyone: { name: string; team: string; points: number; picked: boolean }[];
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Lines up the recommended XI against the players who actually played (names paired strictly, each used once)
 * and scores it with the captain multipliers. A recommended player who did not play scores 0.
 */
export function proofResult(played: Played[], rec: RecPick[], captain: string, vc: string, source: string, extra?: (r: string, c: string) => boolean, mult = { c: 2, vc: 1.5 }): ProofResult {
  const pair = pairNames(played.map((p) => p.name), rec.map((r) => r.name), extra);
  const recFor = new Map(pair.paired.map((x) => [x.rec, x.read]));
  const by = new Map<string, Played[]>();
  for (const p of played) by.set(p.name, [...(by.get(p.name) ?? []), p]);
  const pointsOf = (recName: string): number | null => {
    const read = recFor.get(recName);
    if (!read) return null;
    return by.get(read)?.[0]?.points ?? null;
  };
  const picks = rec.map((r) => {
    const pts = pointsOf(r.name);
    const badge = r.name === captain ? 'C' : r.name === vc ? 'VC' : null;
    const m = badge === 'C' ? mult.c : badge === 'VC' ? mult.vc : 1;
    return { ...r, played: pts !== null, points: pts, counted: pts === null ? null : r1(pts * m), badge } as ProofResult['picks'][number];
  });
  const pickedReads = new Set(pair.paired.map((x) => x.read));
  const sorted = [...played].sort((a, b) => b.points - a.points);
  const top11 = sorted.slice(0, 11).reduce((s, p, i) => s + p.points * (i === 0 ? mult.c : i === 1 ? mult.vc : 1), 0);
  return {
    source,
    playedCount: played.length,
    picks,
    didNotPlay: pair.missing,
    total: r1(picks.reduce((s, p) => s + (p.counted ?? 0), 0)),
    bestPossible: played.length >= 11 ? r1(top11) : null,
    everyone: sorted.map((p) => ({ name: p.name, team: p.team, points: p.points, picked: pickedReads.has(p.name) })),
  };
}
