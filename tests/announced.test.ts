import { describe, expect, it } from 'vitest';
import { mapAnnounced } from '../shared/names';

const pool = (names: string[]) => names.map((n) => ({ key: n.toLowerCase().replace(/[^a-z]/g, ''), name: n }));

// Today's real case: the squad list holds Dream11-style short names; the announced XI uses full names
const PAK = pool(['A Ahmed', 'A Minhas', 'A Samad', 'F Zaman', 'H Nawaz', 'K Nafay', 'M Imran', 'M Sadaqat', 'N Shah', 'Razaullah', 'S Ayub', 'S Farhan', 'S Khan', 'S Mirza', 'S Muqeem']);
const PAK_XI = ['Fakhar Zaman', 'Sahibzada Farhan', 'Maaz Sadaqat', 'Hasan Nawaz', 'Abdul Samad', 'Khawaja Nafay', 'Arafat Minhas', 'Mohammad Imran', 'Razaullah', 'Salman Mirza', 'Sufiyan Moqim'];
const SL = pool(['B Fernando', 'C Wickra', 'D Chamee', 'D Shanaka', 'D Wellalage', 'E Malinga', 'K Mendis (BAT)', 'K Mendis (WK)', 'K Mishara', 'L Udara', 'M Theeks', 'N Thushara', 'S Arachch', 'S Jayawarde', 'V Viyaska']);
const SL_XI = ['Lahiru Udara', 'Sineth Jayawardena', 'Kusal Mendis', 'Kamindu Mendis', 'Sahan Arachige', 'Dasun Shanaka', 'Chamindu Wickramasinghe', 'Vijaykanth Viyaskanth', 'Eshan Malinga', 'Binura Fernando', 'Nuwan Thushara'];

describe('mapAnnounced', () => {
  it('links all 11 Pakistan players, flagging the one matched by spelling', () => {
    const r = mapAnnounced(PAK_XI, PAK);
    expect(r.unmatched).toEqual([]);
    expect(new Set(r.keys).size).toBe(11);
    expect(r.keys).not.toContain('sayub');
    expect(r.guessed).toEqual([{ announced: 'Sufiyan Moqim', matched: 'S Muqeem' }]);
  });
  it('links all 11 Sri Lanka players, including both Mendis and truncated names', () => {
    const r = mapAnnounced(SL_XI, SL);
    expect(r.unmatched).toEqual([]);
    expect(new Set(r.keys).size).toBe(11);
    expect(r.keys).toEqual(expect.arrayContaining(['kmendisbat', 'kmendiswk', 'cwickra', 'sarachch', 'sjayawarde', 'vviyaska']));
  });
  it('does not guess when one announced name fits two squad players', () => {
    const r = mapAnnounced(['Kusal Mendis'], pool(['K Mendis (BAT)', 'K Mendis (WK)']));
    expect(r.keys).toEqual([]);
    expect(r.unmatched).toEqual(['Kusal Mendis']);
  });
  it('leaves a stranger unmatched instead of picking a similar-looking player', () => {
    const r = mapAnnounced(['Zubair Qureshi'], PAK);
    expect(r.keys).toEqual([]);
  });
});
