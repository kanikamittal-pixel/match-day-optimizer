import { describe, expect, it } from 'vitest';
import fixture from './fixtures/cricsheet_1552776.json';
import { parseCricsheetMatch, type ParsedMatch } from '../backend/services/cricsheet';

const result = parseCricsheetMatch(fixture, '1552776');
if (result.skip) throw new Error(result.skip);
const parsed = result as ParsedMatch;
const raw = fixture as any;
const by = (n: string) => parsed.rows.find((r) => r.player === n)!;
const sum = (f: (r: ParsedMatch['rows'][number]) => number, team?: string) => parsed.rows.filter((r) => !team || r.team === team).reduce((s, r) => s + f(r), 0);

describe('parseCricsheetMatch (Bangladesh v Pakistan, Asian Games T20, 1 Oct 2026)', () => {
  it('reads the match metadata', () => {
    expect(parsed.playedOn).toBe('2026-10-01');
    expect(parsed.matchType).toBe('T20');
    expect(parsed.rows.every((r) => r.team === 'Bangladesh' || r.team === 'Pakistan')).toBe(true);
  });

  it('has one row per squad member', () => {
    expect(parsed.rows.length).toBe(raw.info.players.Bangladesh.length + raw.info.players.Pakistan.length);
    expect(new Set(parsed.rows.map((r) => `${r.team}|${r.name_key}`)).size).toBe(parsed.rows.length);
    expect(parsed.rows.every((r) => r.agg.played)).toBe(true);
  });

  it('conserves runs, balls, wickets and dots exactly against the raw deliveries', () => {
    const t = { runs: { Bangladesh: 0, Pakistan: 0 } as Record<string, number>, faced: 0, legal: 0, wickets: 0, dots: 0, charged: 0 };
    for (const inn of raw.innings) for (const ov of inn.overs) for (const d of ov.deliveries) {
      t.runs[inn.team] += d.runs.batter;
      const wides = d.extras?.wides ?? 0, noballs = d.extras?.noballs ?? 0;
      const byes = (d.extras?.byes ?? 0) + (d.extras?.legbyes ?? 0) + (d.extras?.penalty ?? 0);
      if (wides === 0) t.faced += 1;
      if (wides === 0 && noballs === 0) { t.legal += 1; if (d.runs.total - byes === 0) t.dots += 1; }
      t.charged += d.runs.total - byes;
      for (const w of d.wickets ?? []) if (['bowled', 'lbw', 'caught', 'stumped', 'caught and bowled', 'hit wicket'].includes(w.kind)) t.wickets += 1;
    }
    expect(sum((r) => r.agg.runs, 'Bangladesh')).toBe(t.runs.Bangladesh);
    expect(sum((r) => r.agg.runs, 'Pakistan')).toBe(t.runs.Pakistan);
    expect(sum((r) => r.agg.balls)).toBe(t.faced);
    expect(sum((r) => r.agg.ballsBowled)).toBe(t.legal);
    expect(sum((r) => r.agg.dots)).toBe(t.dots);
    expect(sum((r) => r.agg.runsConceded)).toBe(t.charged);
    expect(sum((r) => r.agg.wickets)).toBe(t.wickets);
  });

  it('credits catches, stumpings and run-outs to fielders, and wickets to bowlers', () => {
    // Sahibzada Farhan caught Tanzid Hasan off Arafat Minhas (1.4); Saim Ayub bowled Liton Das (2.3)
    expect(by('Sahibzada Farhan').agg.catches).toBeGreaterThanOrEqual(1);
    expect(by('Saim Ayub').agg.wickets).toBeGreaterThanOrEqual(1);
    expect(by('Saim Ayub').agg.lbwBowled).toBeGreaterThanOrEqual(1);
    expect(by('Saim Ayub').points).toBeGreaterThanOrEqual(4 + 30 + 8);
    // Rishad Hossain run out by Usman Khan and Ahmed Daniyal (two fielders -> 6 each, indirect)
    expect(by('Usman Khan').agg.runOutsIndirect).toBe(1);
    expect(by('Ahmed Daniyal').agg.runOutsIndirect).toBe(1);
  });

  it('gives batting positions and uses the batting side for each innings', () => {
    expect(by('Saif Hassan').bat_pos).toBe(1);
    expect(by('Tanzid Hasan').bat_pos).toBe(2);
    expect(by('Sahibzada Farhan').team).toBe('Pakistan');
  });

  it('skips non-T20 and no-result matches', () => {
    expect(parseCricsheetMatch({ info: { teams: ['A', 'B'], match_type: 'ODI' }, innings: [] }, 'x').skip).toMatch(/not T20/);
    expect(parseCricsheetMatch({ info: { teams: ['A', 'B'], match_type: 'T20', outcome: { result: 'no result' } }, innings: [{}] }, 'x').skip).toBe('no result');
  });
});
