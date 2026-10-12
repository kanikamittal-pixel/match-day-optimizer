/**
 * Post-mortem of a prediction against what actually happened. Pure functions, so every number can be tested.
 * "Actual" points are computed from Cricsheet ball-by-ball with the Dream11 T20 table (see shared/scoring.ts):
 * an estimate of Dream11's own totals, not the official figures.
 */
export interface PMPlayer {
  name: string;
  team: string;
  role: string;
  batPos: number | null;
  predicted: number; // what the agent expected
  base: number | null; // code-computed base (history), null if none
  adjustment: number | null; // Gemini's conditions adjustment
  actual: number;
  baseline: number | null; // mean of the last 5 matches, null if unknown
  inAgentXI: boolean;
  inHindsightXI: boolean;
  inBaselineXI: boolean;
}

export interface TeamResult {
  xi: string[];
  captain: string;
  vc: string;
  points: number; // with captain 2x and vice-captain 1.5x
}

export interface Metrics {
  agent: number;
  baseline: number;
  hindsight: number;
  agentPctOfHindsight: number;
  maeAgent: number;
  maeBaseline: number | null;
  nBaseline: number;
  spearmanAgent: number | null;
  captainRank: number; // 1 = the captain scored the most of all 22+ players
  captainActual: number;
  bestCaptainInXI: { name: string; actual: number };
}

export interface Finding {
  kind: 'xi' | 'captain' | 'adjustment' | 'history' | 'role' | 'position' | 'miss';
  severity: 'info' | 'warn' | 'bad';
  text: string;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
const r1 = (n: number) => Math.round(n * 10) / 10;

export function teamPoints(players: PMPlayer[], xi: string[], captain: string, vc: string, capMult = 2, vcMult = 1.5): number {
  const by = new Map(players.map((p) => [p.name, p]));
  return r1(xi.reduce((s, n) => s + (by.get(n)?.actual ?? 0) * (n === captain ? capMult : n === vc ? vcMult : 1), 0));
}

const bucket = (pos: number | null) => (!pos ? 'did not bat / unknown' : pos <= 2 ? 'openers (1-2)' : pos <= 4 ? 'top order (3-4)' : pos <= 6 ? 'middle order (5-6)' : 'lower order (7+)');

function rank(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return r;
}
export function spearman(x: number[], y: number[]): number | null {
  if (x.length < 3) return null;
  const a = rank(x), b = rank(y), ma = mean(a), mb = mean(b);
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? n / Math.sqrt(da * db) : null;
}

export function analyse(players: PMPlayer[], agent: TeamResult, baselineTeam: TeamResult, hindsight: TeamResult): { metrics: Metrics; findings: Finding[]; byRole: { key: string; n: number; bias: number }[]; byPosition: { key: string; n: number; bias: number }[] } {
  const maeAgent = mean(players.map((p) => Math.abs(p.predicted - p.actual)));
  const withBaseline = players.filter((p) => p.baseline !== null);
  const maeBaseline = withBaseline.length ? mean(withBaseline.map((p) => Math.abs((p.baseline as number) - p.actual))) : null;

  const sorted = [...players].sort((a, b) => b.actual - a.actual);
  const capPlayer = players.find((p) => p.name === agent.captain)!;
  const captainRank = 1 + sorted.findIndex((p) => p.name === agent.captain);
  const inXI = players.filter((p) => agent.xi.includes(p.name));
  const bestInXI = [...inXI].sort((a, b) => b.actual - a.actual)[0];

  const metrics: Metrics = {
    agent: agent.points, baseline: baselineTeam.points, hindsight: hindsight.points,
    agentPctOfHindsight: Math.round((agent.points / hindsight.points) * 100),
    maeAgent: r1(maeAgent), maeBaseline: maeBaseline === null ? null : r1(maeBaseline), nBaseline: withBaseline.length,
    spearmanAgent: (() => { const s = spearman(players.map((p) => p.predicted), players.map((p) => p.actual)); return s === null ? null : Math.round(s * 100) / 100; })(),
    captainRank, captainActual: capPlayer.actual, bestCaptainInXI: { name: bestInXI.name, actual: bestInXI.actual },
  };

  const group = (f: (p: PMPlayer) => string) => {
    const g = new Map<string, number[]>();
    for (const p of players) g.set(f(p), [...(g.get(f(p)) ?? []), p.predicted - p.actual]);
    return [...g].map(([key, v]) => ({ key, n: v.length, bias: r1(mean(v)) })).sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias));
  };
  const byRole = group((p) => p.role);
  const byPosition = group((p) => bucket(p.batPos));

  const findings: Finding[] = [];
  // 1. the XI
  const gap = hindsight.points - agent.points;
  findings.push({ kind: 'xi', severity: agent.points >= hindsight.points * 0.75 ? 'info' : agent.points >= hindsight.points * 0.6 ? 'warn' : 'bad', text: `Our XI scored ${agent.points} against a best possible ${hindsight.points} (${metrics.agentPctOfHindsight}%), a gap of ${r1(gap)} points. A simple last-5-average XI scored ${baselineTeam.points}.` });

  // 2. who we got wrong
  const wrongIn = inXI.map((p) => ({ p, err: p.predicted - p.actual })).sort((a, b) => b.err - a.err).slice(0, 3).filter((x) => x.err >= 20);
  for (const { p, err } of wrongIn) findings.push({ kind: 'miss', severity: err >= 50 ? 'bad' : 'warn', text: `Picked ${p.name} (${p.role}${p.batPos ? `, batted ${p.batPos}` : ''}) expecting ${p.predicted} but he scored ${p.actual}: ${r1(err)} points too high.${p.base !== null ? ` History said ${p.base}.` : ' No history was found for him.'}` });
  const missedStars = players.filter((p) => p.inHindsightXI && !p.inAgentXI).sort((a, b) => b.actual - a.actual).slice(0, 3);
  for (const p of missedStars) {
    const predRank = 1 + [...players].sort((a, b) => b.predicted - a.predicted).findIndex((q) => q.name === p.name);
    findings.push({ kind: 'miss', severity: p.actual >= 120 ? 'bad' : 'warn', text: `Left out ${p.name} (${p.role}${p.batPos ? `, batted ${p.batPos}` : ''}) who scored ${p.actual}. We had him at ${p.predicted}, ranked #${predRank} of ${players.length}.${p.base !== null ? ` History base was ${p.base}.` : ' No history was found for him.'}` });
  }

  // 3. captain
  const capSev = captainRank <= 3 ? 'info' : captainRank <= Math.ceil(players.length * 0.25) ? 'warn' : 'bad'; // relative to the size of the match
  findings.push({ kind: 'captain', severity: capSev, text: `Captain ${agent.captain} scored ${capPlayer.actual}, #${captainRank} of ${players.length} players. The best captain inside our own XI would have been ${bestInXI.name} (${bestInXI.actual})${bestInXI.name === agent.captain ? ', which is who we picked' : `, worth ${r1((bestInXI.actual - capPlayer.actual) * 1)} more points at 2x`}.` });

  // 4. did Gemini's adjustment help?
  const adj = players.filter((p) => p.base !== null && p.adjustment !== null);
  if (adj.length >= 5) {
    const gains = adj.map((p) => Math.abs((p.base as number) - p.actual) - Math.abs(p.predicted - p.actual));
    const helped = gains.filter((g) => g > 0).length;
    const g = mean(gains);
    findings.push({ kind: 'adjustment', severity: g >= 0 ? 'info' : Math.abs(g) >= 3 ? 'bad' : 'warn', text: `Gemini's pitch and conditions adjustment ${g >= 0 ? 'improved' : 'worsened'} the prediction by ${Math.abs(r1(g))} points per player on average, and helped ${helped} of ${adj.length} players. ${g < 0 ? 'The history-only base was closer than the adjusted number.' : ''}`.trim() });
  }

  // 5. history coverage
  const noBase = players.filter((p) => p.base === null);
  const hasBase = players.filter((p) => p.base !== null);
  if (noBase.length >= 2 && hasBase.length >= 2) {
    const a = mean(noBase.map((p) => Math.abs(p.predicted - p.actual))), b = mean(hasBase.map((p) => Math.abs(p.predicted - p.actual)));
    findings.push({ kind: 'history', severity: a > b + 5 ? 'warn' : 'info', text: `${noBase.length} of ${players.length} players had no usable history. Their average miss was ${r1(a)} points, against ${r1(b)} for the ${hasBase.length} players with history.` });
  }

  // 6. systematic bias
  for (const g of byRole) if (g.n >= 4 && Math.abs(g.bias) >= 8) findings.push({ kind: 'role', severity: 'warn', text: `${g.key} players were predicted ${Math.abs(g.bias)} points too ${g.bias > 0 ? 'high' : 'low'} on average (${g.n} players).` });
  for (const g of byPosition) if (g.n >= 4 && Math.abs(g.bias) >= 10 && g.key !== 'did not bat / unknown') findings.push({ kind: 'position', severity: 'warn', text: `${g.key} were predicted ${Math.abs(g.bias)} points too ${g.bias > 0 ? 'high' : 'low'} on average (${g.n} players).` });

  return { metrics, findings, byRole, byPosition };
}
