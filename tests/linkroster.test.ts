import { describe, expect, it } from 'vitest';
import { linkRoster } from '../shared/names';

// Today's real Sri Lanka and Pakistan rosters as Cricsheet writes them, with the register's alternative spellings
const SL_ROSTER = ['BKG Mendis', 'PHKD Mendis', 'BMAJ Mendis', 'HIS Mendis', 'BYA Mendis', 'RTM Mendis', 'MD Shanaka', 'SSD Arachchige', 'C Wickramasinghe', 'V Viyaskanth', 'N Thushara', 'E Malinga', 'B Fernando', 'Lahiru Udara', 'Sineth Jayawardena'];
const ALIASES: Record<string, string[]> = { 'BKG Mendis': ['Kusal Mendis'], 'MD Shanaka': ['Dasun Shanaka', 'D Shanaka'], 'BMAJ Mendis': ['J Mendis'], 'BYA Mendis': ['Y Mendis'] };
const PAK_ROSTER = ['Mohammad Imran Randhawa', 'Fakhar Zaman', 'Sahibzada Farhan', 'Salman Mirza'];

describe('linkRoster', () => {
  it('links both Mendis correctly with full names (one by alias, one by initials and elimination)', () => {
    const l = linkRoster([{ key: 'k', names: ['Kusal Mendis', 'K Mendis (WK)'] }, { key: 'm', names: ['Kamindu Mendis', 'K Mendis (BAT)'] }], SL_ROSTER, ALIASES);
    expect(l.get('k')).toBe('BKG Mendis');
    expect(l.get('m')).toBe('PHKD Mendis');
  });
  it('links truncated and full names to initials-style Cricsheet names', () => {
    const l = linkRoster([{ key: 'a', names: ['Sahan Arachchige'] }, { key: 'c', names: ['Chamindu Wickramasinghe'] }, { key: 'v', names: ['Vijayakanth Viyaskanth'] }, { key: 's', names: ['Dasun Shanaka'] }], SL_ROSTER, ALIASES);
    expect([l.get('a'), l.get('c'), l.get('v'), l.get('s')]).toEqual(['SSD Arachchige', 'C Wickramasinghe', 'V Viyaskanth', 'MD Shanaka']);
  });
  it('links a name that is part of a longer Cricsheet name', () => {
    expect(linkRoster([{ key: 'i', names: ['Mohammad Imran'] }], PAK_ROSTER, {}).get('i')).toBe('Mohammad Imran Randhawa');
  });
  it('still refuses when two short "K Mendis" names are all that is known', () => {
    const l = linkRoster([{ key: 'a', names: ['K Mendis (WK)'] }, { key: 'b', names: ['K Mendis (BAT)'] }], SL_ROSTER, ALIASES);
    expect(l.get('a')).toBeUndefined(); // two short names on one Cricsheet player: both dropped
    expect(l.get('b')).toBeUndefined();
  });
  it('never links a stranger', () => {
    expect(linkRoster([{ key: 'z', names: ['Zubair Qureshi'] }], SL_ROSTER, ALIASES).size).toBe(0);
  });
  it('copes with a spelling that differs from Cricsheet (Hasan/Hassan, Moqim/Muqeem) by falling back to the short name', () => {
    const roster = ['Hassan Nawaz', 'Sufiyan Muqeem', 'Fakhar Zaman'];
    const l = linkRoster([{ key: 'h', names: ['Hasan Nawaz', 'H Nawaz'] }, { key: 's', names: ['Sufiyan Moqim', 'S Muqeem'] }], roster, {});
    expect([l.get('h'), l.get('s')]).toEqual(['Hassan Nawaz', 'Sufiyan Muqeem']);
  });
  it('does not let the short-name fallback take a name another player already holds', () => {
    const l = linkRoster([{ key: 'k', names: ['Kusal Mendis', 'K Mendis (WK)'] }, { key: 'm', names: ['Kasun Mendis', 'K Mendis (BAT)'] }], SL_ROSTER, ALIASES);
    expect(l.get('k')).toBe('BKG Mendis');
    expect(l.get('m')).not.toBe('BKG Mendis');
  });
});
