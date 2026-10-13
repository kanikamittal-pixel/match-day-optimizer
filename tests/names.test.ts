import { describe, expect, it } from 'vitest';

import { uniqueCanon } from '../shared/names';
describe('uniqueCanon', () => {
  it('keeps matched names when they are unique', () => {
    expect(uniqueCanon([{ team: 'A', name: 'S Ayub', canon: 'Saim Ayub' }, { team: 'A', name: 'B Azam', canon: 'Babar Azam' }])).toEqual(['Saim Ayub', 'Babar Azam']);
  });
  it('never gives two players on one side the same name', () => {
    const r = uniqueCanon([{ team: 'SL', name: 'Kusal Mendis', canon: 'KJ Mendis' }, { team: 'SL', name: 'Kamindu Mendis', canon: 'KJ Mendis' }]);
    expect(new Set(r).size).toBe(2);
    expect(r).toEqual(['Kusal Mendis', 'Kamindu Mendis']);
  });
  it('allows the same name on different sides', () => {
    expect(uniqueCanon([{ team: 'A', name: 'X', canon: 'Same' }, { team: 'B', name: 'Y', canon: 'Same' }])).toEqual(['Same', 'Same']);
  });
});
