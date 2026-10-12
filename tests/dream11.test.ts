import { describe, expect, it } from 'vitest';
import { checkRules } from '../shared/dream11';
import { DEFAULT_RULES } from '../shared/weights';

describe('checkRules (only rules Dream11 accepts)', () => {
  it('accepts the defaults', () => expect('rules' in checkRules(DEFAULT_RULES)).toBe(true));
  it('always keeps 11 players and the 2x / 1.5x multipliers', () => {
    const r = checkRules({ ...DEFAULT_RULES, team_size: 9, captain_mult: 3, vc_mult: 2 }) as any;
    expect(r.rules.team_size).toBe(11); expect(r.rules.captain_mult).toBe(2); expect(r.rules.vc_mult).toBe(1.5);
  });
  it('lets Aryan tighten but not loosen', () => {
    expect('rules' in checkRules({ ...DEFAULT_RULES, max_per_team: 7, credit_cap: 95, role_max: { ...DEFAULT_RULES.role_max, BAT: 5 } })).toBe(true);
    expect('error' in checkRules({ ...DEFAULT_RULES, max_per_team: 11 })).toBe(true);
    expect('error' in checkRules({ ...DEFAULT_RULES, credit_cap: 120 })).toBe(true);
    expect('error' in checkRules({ ...DEFAULT_RULES, role_min: { ...DEFAULT_RULES.role_min, WK: 0 } })).toBe(true);
    expect('error' in checkRules({ ...DEFAULT_RULES, role_max: { ...DEFAULT_RULES.role_max, BOWL: 8 } })).toBe(true);
  });
  it('rejects role limits that cannot make a team of 11', () => {
    expect('error' in checkRules({ ...DEFAULT_RULES, role_max: { WK: 1, BAT: 3, AR: 1, BOWL: 3 } })).toBe(true);
  });
});
