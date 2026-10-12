import { describe, expect, it } from 'vitest';
import { analyse, spearman, teamPoints, type PMPlayer } from '../shared/backtest';

const P = (name: string, role: string, predicted: number, actual: number, o: Partial<PMPlayer> = {}): PMPlayer => ({
  name, team: 'A', role, batPos: 1, predicted, base: predicted, adjustment: 0, actual, baseline: predicted, inAgentXI: false, inHindsightXI: false, inBaselineXI: false, ...o,
});

describe('teamPoints', () => {
  it('applies captain 2x and vice-captain 1.5x', () => {
    const ps = [P('a', 'BAT', 0, 10), P('b', 'BAT', 0, 20), P('c', 'BAT', 0, 30)];
    expect(teamPoints(ps, ['a', 'b', 'c'], 'c', 'b')).toBe(10 + 20 * 1.5 + 30 * 2);
  });
});

describe('spearman', () => {
  it('is 1 for identical ordering and -1 for reversed', () => {
    expect(spearman([1, 2, 3, 4], [5, 6, 7, 8])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [8, 7, 6, 5])).toBeCloseTo(-1);
    expect(spearman([1, 2], [1, 2])).toBeNull();
  });
});

describe('analyse', () => {
  const players = [
    P('star', 'BAT', 40, 150, { inHindsightXI: true, batPos: 3 }),
    P('flop', 'AR', 90, 10, { inAgentXI: true, batPos: 5 }),
    P('ok1', 'BAT', 50, 55, { inAgentXI: true, inHindsightXI: true }),
    P('ok2', 'BOWL', 40, 45, { inAgentXI: true, base: null, adjustment: null, batPos: 9 }),
    P('ok3', 'BOWL', 35, 30, { inAgentXI: true, base: null, adjustment: null, batPos: 10 }),
    P('ok4', 'WK', 45, 60, { inAgentXI: true, batPos: 2 }),
  ];
  const agent = { xi: ['flop', 'ok1', 'ok2', 'ok3', 'ok4'], captain: 'flop', vc: 'ok1', points: 0 };
  agent.points = teamPoints(players, agent.xi, agent.captain, agent.vc);
  const hind = { xi: ['star', 'ok1', 'ok4'], captain: 'star', vc: 'ok4', points: 0 };
  hind.points = teamPoints(players, hind.xi, hind.captain, hind.vc);
  const base = { xi: ['star', 'ok1'], captain: 'ok1', vc: 'star', points: 0 };
  base.points = teamPoints(players, base.xi, base.captain, base.vc);
  const r = analyse(players, agent, base, hind);

  it('computes XI metrics', () => {
    expect(r.metrics.agent).toBe(agent.points);
    expect(r.metrics.hindsight).toBe(hind.points);
    expect(r.metrics.captainRank).toBe(players.length); // the captain scored the lowest of all
    expect(r.metrics.bestCaptainInXI.name).toBe('ok4');
  });
  it('flags the wrong pick, the missed star and the poor captain', () => {
    const text = r.findings.map((f) => f.text).join(' | ');
    expect(text).toMatch(/Picked flop .* 80 points too high/);
    expect(text).toMatch(/Left out star .* scored 150/);
    expect(r.findings.find((f) => f.kind === 'captain')?.severity).toBe('bad');
  });
  it('reports history coverage', () => {
    expect(r.findings.some((f) => f.kind === 'history' && /2 of 6 players had no usable history/.test(f.text))).toBe(true);
  });
  it('groups bias by role and batting position', () => {
    expect(r.byRole.find((g) => g.key === 'AR')?.bias).toBe(80);
    expect(r.byPosition.length).toBeGreaterThan(1);
  });
});
