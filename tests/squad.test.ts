import { describe, expect, it } from 'vitest';
import { countsByTeam, defaultXI, readiness } from '../shared/squad';

const T: [string, string] = ['Pakistan', 'Sri Lanka'];
const mk = (team: string, n: number, probable: number) => Array.from({ length: n }, (_, i) => ({ name: `${team}${i}`, team, probable: i < probable, inXI: false }));

describe('defaultXI', () => {
  it('selects the probable players when each side has 1 to 11 flagged', () => {
    const rows = [...mk('Pakistan', 15, 11), ...mk('Sri Lanka', 15, 11)];
    const sel = defaultXI(rows, T);
    expect(sel.filter(Boolean).length).toBe(22);
    expect(sel[0]).toBe(true);
    expect(sel[11]).toBe(false);
  });
  it('selects nobody for a side with no usable probable list', () => {
    const rows = [...mk('Pakistan', 15, 11), ...mk('Sri Lanka', 15, 0)];
    const sel = defaultXI(rows, T);
    expect(sel.slice(0, 15).filter(Boolean).length).toBe(11);
    expect(sel.slice(15).filter(Boolean).length).toBe(0);
  });
  it('treats "everything flagged" (a full squad of 15) as unusable', () => {
    const rows = [...mk('Pakistan', 15, 15), ...mk('Sri Lanka', 11, 11)];
    expect(defaultXI(rows, T).slice(0, 15).some(Boolean)).toBe(false);
  });
});

describe('readiness', () => {
  const rows = (a: number, b: number, extra = 0) => [...mk('Pakistan', a + extra, 0).map((r, i) => ({ ...r, inXI: i < a })), ...mk('Sri Lanka', b + extra, 0).map((r, i) => ({ ...r, inXI: i < b }))];
  it('is ready with 11 + 11, warns with a short side, blocks below 11 in total', () => {
    expect(readiness(rows(11, 11), T)).toMatchObject({ ok: true, level: 'ok' });
    expect(readiness(rows(11, 9, 2), T)).toMatchObject({ ok: true, level: 'warn' });
    expect(readiness(rows(5, 4, 4), T)).toMatchObject({ ok: false, level: 'bad' });
    expect(readiness(rows(2, 2), T)).toMatchObject({ ok: false });
  });
  it('counts per team', () => {
    expect(countsByTeam(rows(7, 4, 4), T)).toEqual([7, 4]);
  });
});
