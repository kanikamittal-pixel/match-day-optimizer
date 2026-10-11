import { describe, expect, it } from 'vitest';
import { buildBestXI, suggestFixes, validateTeam } from '../lib/rules';
import { isGenericReason } from '../lib/reasons';
import { matchName } from '../lib/names';
import { DEFAULT_RULES } from '../lib/weights';
import type { Candidate, Role } from '../lib/types';

let i = 0;
const mk = (team: string, role: Role, credit: number, xp: number): Candidate => {
  i++;
  return { key: `p${i}`, name: `Player ${i}`, team, role, credit, xp };
};
const pool = (): Candidate[] => {
  i = 0;
  const out: Candidate[] = [];
  for (const t of ['A', 'B']) {
    out.push(mk(t, 'WK', 8.5, 30), mk(t, 'WK', 8, 20));
    for (let k = 0; k < 4; k++) out.push(mk(t, 'BAT', 9 - k * 0.5, 40 - k * 5));
    for (let k = 0; k < 2; k++) out.push(mk(t, 'AR', 9, 45 - k * 3));
    for (let k = 0; k < 4; k++) out.push(mk(t, 'BOWL', 8.5 - k * 0.5, 35 - k * 3));
  }
  return out;
};

describe('buildBestXI', () => {
  it('returns a valid team satisfying every rule', () => {
    const r = buildBestXI(pool(), DEFAULT_RULES)!;
    expect(r).not.toBeNull();
    expect(validateTeam(r.team, DEFAULT_RULES)).toEqual([]);
    expect(r.team).toHaveLength(11);
    expect(r.credits).toBeLessThanOrEqual(100);
  });
  it('is optimal against brute force on a small pool', () => {
    const small = pool().slice(0, 16);
    const rules = { ...DEFAULT_RULES, credit_cap: 95 };
    const got = buildBestXI(small, rules)!;
    let best = -1;
    const rec = (idx: number, picked: Candidate[]) => {
      if (picked.length === 11) {
        if (!validateTeam(picked, rules).length) best = Math.max(best, picked.reduce((s, p) => s + p.xp, 0));
        return;
      }
      if (idx >= small.length) return;
      rec(idx + 1, [...picked, small[idx]]);
      rec(idx + 1, picked);
    };
    rec(0, []);
    expect(got.totalXp).toBeCloseTo(best, 5);
  });
  it('honours pinned players', () => {
    const p = pool();
    const weak = p.reduce((a, b) => (a.xp < b.xp ? a : b));
    const r = buildBestXI(p, DEFAULT_RULES, [weak.key])!;
    expect(r.team.some((x) => x.key === weak.key)).toBe(true);
  });
  it('returns null when no valid XI exists', () => {
    expect(buildBestXI(pool().slice(0, 8), DEFAULT_RULES)).toBeNull();
  });
});

describe('validateTeam / suggestFixes', () => {
  it('flags too many from one team and ineligible players', () => {
    const p = pool();
    const sevenPlus = p.filter((x) => x.team === 'A').slice(0, 8).concat(p.filter((x) => x.team === 'B').slice(0, 3));
    expect(validateTeam(sevenPlus, DEFAULT_RULES).map((v) => v.code)).toContain('team_max');
    expect(validateTeam(sevenPlus, DEFAULT_RULES, new Set()).map((v) => v.code)).toContain('ineligible');
  });
  it('suggests swaps that keep the locked pick', () => {
    const p = pool();
    const best = buildBestXI(p, DEFAULT_RULES)!.team;
    const outsider = p.find((x) => !best.includes(x) && x.team === best[0].team)!;
    const broken = best.slice(1).concat(outsider);
    const fixes = suggestFixes(broken, p, { ...DEFAULT_RULES, max_per_team: 6 }, [outsider.key]);
    for (const f of fixes) expect(f.drop.key).not.toBe(outsider.key);
  });
});

describe('isGenericReason', () => {
  const ctx = { venue: 'Wankhede Stadium, Mumbai', teams: ['Mumbai Indians', 'Chennai Super Kings'] };
  it('rejects filler', () => {
    expect(isGenericReason('He is in good form and a key player for the side.', ctx)).toBe(true);
    expect(isGenericReason('Reliable option who should perform well today overall.', ctx)).toBe(true);
  });
  it('accepts match-specific reasons', () => {
    expect(isGenericReason('Opens on a true Wankhede surface where par is 185.', ctx)).toBe(false);
    expect(isGenericReason('Averages 41 against CSK spinners in the middle overs.', ctx)).toBe(false);
  });
});

describe('matchName', () => {
  const known = [
    { key: 'viratkohli', name: 'Virat Kohli' },
    { key: 'rohitsharma', name: 'Rohit Sharma' },
    { key: 'ishansharma', name: 'Ishant Sharma' },
  ];
  it('matches initials and surnames', () => {
    expect(matchName('V Kohli', known)).toBe('viratkohli');
    expect(matchName('kohli', known)).toBe('viratkohli');
    expect(matchName('R Sharma', known)).toBe('rohitsharma');
    expect(matchName('Sharma', known)).toBeNull();
  });
});
