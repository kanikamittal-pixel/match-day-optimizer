import { describe, expect, it } from 'vitest';
import { summariseForm, formLine } from '../shared/form';

describe('summariseForm', () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ key: 'a', points: i + 1, when: `2026-01-${String(i + 1).padStart(2, '0')}` }));
  it('keeps the latest 10 matches, newest first', () => {
    const f = summariseForm(rows).a;
    expect(f.n).toBe(10);
    expect(f.points[0]).toBe(12);
    expect(f.points[9]).toBe(3);
    expect(f.avg).toBe(7.5);
  });
  it('flags short histories and missing ones', () => {
    const f = summariseForm([{ key: 'b', points: 40, when: '2026-02-01' }, { key: 'b', points: 20, when: '2026-02-05' }]).b;
    expect(formLine(f)).toContain('too few to weigh');
    expect(formLine(undefined)).toContain('no history');
  });
});

import { blendBase } from '../shared/form';
import { matchStrict } from '../shared/names';

describe('blendBase (equal weights)', () => {
  it('averages overall and recent 50/50 when both are reliable', () => {
    expect(blendBase({ n_all: 40, mean_all: 30, n_recent: 10, mean_recent: 50 })).toEqual({ base: 40, basis: '50% overall + 50% recent' });
  });
  it('falls back to the one that is reliable, and says so', () => {
    expect(blendBase({ n_all: 40, mean_all: 30, n_recent: 2, mean_recent: 90 })?.base).toBe(30);
    expect(blendBase({ n_all: 3, mean_all: 30, n_recent: 5, mean_recent: 44 })?.base).toBe(44);
    expect(blendBase({ n_all: 3, mean_all: 30, n_recent: 2, mean_recent: 44 })).toBeNull();
  });
});

describe('matchStrict', () => {
  const squad = ['Sahibzada Farhan', 'Fakhar Zaman', 'Naseem Shah', 'Shadab Khan', 'Imad Wasim', 'Imran Khan', 'Mohammad Nawaz', 'Hasan Nawaz'];
  it('needs surname AND initial and exactly one hit', () => {
    expect(matchStrict('S Farhan', squad)).toBe('Sahibzada Farhan');
    expect(matchStrict('N Shah', squad)).toBe('Naseem Shah');
    expect(matchStrict('S Khan', squad)).toBe('Shadab Khan'); // Imran Khan has a different initial
    expect(matchStrict('H Nawaz', squad)).toBe('Hasan Nawaz');
    expect(matchStrict('M Nawaz', squad)).toBe('Mohammad Nawaz');
    expect(matchStrict('I Khan', squad)).toBe('Imran Khan');
  });
  it('refuses to guess', () => {
    expect(matchStrict('Nawaz', squad)).toBeNull(); // no initial, two Nawaz
    expect(matchStrict('A Zaman', squad)).toBeNull();
    expect(matchStrict('K Mendis (WK)', ['Kusal Mendis', 'Kamindu Mendis'])).toBeNull(); // two K Mendis
  });
  it('handles Dream11 truncation', () => {
    expect(matchStrict('C Wickramas…', ['Charith Wickramasinghe', 'Dasun Shanaka'])).toBe('Charith Wickramasinghe');
  });
});

import { matchStrictAliases } from '../shared/names';

describe('matchStrictAliases (Cricsheet register names)', () => {
  const roster = ['MD Shanaka', 'BKG Mendis', 'PHKD Mendis', 'Saim Ayub', 'Shadab Khan'];
  const aliases = { 'MD Shanaka': ['Dasun Shanaka', 'D Shanaka'], 'BKG Mendis': ['Kusal Mendis'], 'PHKD Mendis': ['Kamindu Mendis'] };
  it('links a short name through a full-name alias', () => {
    expect(matchStrictAliases('D Shanaka', roster, aliases)).toBe('MD Shanaka');
    expect(matchStrictAliases('S Ayub', roster, aliases)).toBe('Saim Ayub');
  });
  it('still refuses when two different players qualify', () => {
    expect(matchStrictAliases('K Mendis', roster, aliases)).toBeNull();
  });
  it('does not match on a different first initial or an unknown surname', () => {
    expect(matchStrictAliases('A Shanaka', roster, aliases)).toBeNull();
    expect(matchStrictAliases('D Silva', roster, aliases)).toBeNull();
  });
  it('works without any aliases (same as matchStrict)', () => {
    expect(matchStrictAliases('S Ayub', roster, {})).toBe('Saim Ayub');
  });
});

import { dropSharedLinks } from '../shared/names';

describe('dropSharedLinks', () => {
  it('drops every link when two squad players resolve to the same person', () => {
    const link = new Map([['kmendiswk', 'BKG Mendis'], ['kmendisbat', 'BKG Mendis'], ['sayub', 'Saim Ayub']]);
    const { kept, dropped } = dropSharedLinks(link);
    expect([...kept.keys()]).toEqual(['sayub']);
    expect(dropped.sort()).toEqual(['kmendisbat', 'kmendiswk']);
  });
  it('keeps everything when links are unique', () => {
    const { kept, dropped } = dropSharedLinks(new Map([['a', 'A'], ['b', 'B']]));
    expect(kept.size).toBe(2);
    expect(dropped).toEqual([]);
  });
});

import { teamLookup } from '../shared/names';

describe('teamLookup', () => {
  it('maps women\'s fixture names to Cricsheet names and gender', () => {
    expect(teamLookup('Sydney Sixers Women')).toEqual({ names: ['Sydney Sixers Women', 'Sydney Sixers'], gender: 'female' });
    expect(teamLookup('Pakistan')).toEqual({ names: ['Pakistan'], gender: 'male' });
    expect(teamLookup("India Women's")).toMatchObject({ gender: 'female' });
    expect(teamLookup('Mumbai Indians').gender).toBe('male');
  });
});
