import { describe, expect, it } from 'vitest';
import { proofResult } from '../shared/proofresult';

const played = [
  { name: 'Saim Ayub', team: 'Pakistan', points: 60 },
  { name: 'Babar Azam', team: 'Pakistan', points: 40 },
  { name: 'Kusal Mendis', team: 'Sri Lanka', points: 30 },
];
const rec = [
  { name: 'S Ayub', role: 'BAT', team: 'Pakistan' },
  { name: 'Babar Azam', role: 'BAT', team: 'Pakistan' },
  { name: 'Shadab Khan', role: 'AR', team: 'Pakistan' },
];

describe('proofResult', () => {
  const r = proofResult(played, rec, 'S Ayub', 'Babar Azam', 'test');
  it('pairs recommended players with the ones who played', () => {
    expect(r.picks.map((p) => p.played)).toEqual([true, true, false]);
    expect(r.didNotPlay).toEqual(['Shadab Khan']);
  });
  it('applies captain and vice-captain multipliers; absent players score 0', () => {
    expect(r.total).toBe(60 * 2 + 40 * 1.5);
  });
  it('lists everyone who played, best first, flagging the picked ones', () => {
    expect(r.everyone.map((p) => [p.name, p.picked])).toEqual([['Saim Ayub', true], ['Babar Azam', true], ['Kusal Mendis', false]]);
  });
});
