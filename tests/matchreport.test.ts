import { describe, expect, it } from 'vitest';
import { matchReport, type RPlayer } from '../shared/matchreport';

const P = (name: string, role: string, actual: number, predicted: number | null, extra: Partial<RPlayer> = {}): RPlayer => ({
  name, team: 'X', role, batPos: role === 'BOWL' ? null : 3, predicted, base: predicted, adjustment: 0, actual, baseline: predicted, reason: null, played: true, inOurXI: false, inTop11: false, ...extra,
});
const players = [P('A', 'BAT', 100, 40), P('B', 'BAT', 20, 60), P('C', 'BOWL', 80, 30, { base: null }), P('D', 'BOWL', 10, 50), P('E', 'AR', 5, 20), P('F', 'AR', 60, 25)];

describe('matchReport', () => {
  const r = matchReport(players, { xi: ['B', 'D', 'E'], captain: 'B', vc: 'D' }, { xi: ['A', 'C', 'F'], captain: 'A', vc: 'C' }, null);
  it('scores both teams with the multipliers', () => {
    expect(r.headline.ourPoints).toBe(20 * 2 + 10 * 1.5 + 5);
    expect(r.headline.topPoints).toBe(100 * 2 + 80 * 1.5 + 60);
    expect(r.headline.overlap).toBe(0);
  });
  it('lists the top-11 players who were not picked, with how the agent ranked them', () => {
    expect(r.missed.map((m) => m.name)).toEqual(['A', 'C', 'F']);
    expect(r.missed[1].why).toContain('No usable history');
    expect(r.missed[0].ourRank).toBe(3);
  });
  it('finds picks that scored far below expectation', () => {
    expect(r.flops.map((f) => f.name)).toContain('B');
  });
  it('ranks the captain among everyone who played and explains the gap', () => {
    expect(r.headline.captain.rank).toBe(4);
    expect(r.lags.some((l) => l.includes('captain'))).toBe(true);
  });
  it('compares role mix', () => {
    expect(r.byRole.find((x) => x.role === 'BAT')).toMatchObject({ ourN: 1, topN: 1 });
  });
});
