import { describe, expect, it } from 'vitest';
import { countdown, dayLabel, localDay } from '../shared/when';

const now = new Date('2026-10-12T10:00:00Z').getTime();
describe('countdown', () => {
  it('formats days, hours and minutes', () => {
    expect(countdown('2026-10-14T13:30:00Z', now)).toBe('Starts in 2d 3h');
    expect(countdown('2026-10-12T13:20:00Z', now)).toBe('Starts in 3h 20m');
    expect(countdown('2026-10-12T10:25:00Z', now)).toBe('Starts in 25 min');
  });
  it('handles started and missing times', () => {
    expect(countdown('2026-10-12T09:00:00Z', now)).toBe('Started');
    expect(countdown(null, now)).toBe('Start time TBC');
  });
});
describe('dayLabel', () => {
  it('says Today and Tomorrow in local time', () => {
    const n = new Date(now);
    expect(dayLabel(new Date(now + 3600000).toISOString(), n)).toBe('Today');
    expect(dayLabel(new Date(now + 86400000 + 3600000).toISOString(), n)).toBe('Tomorrow');
    expect(dayLabel(null, n)).toBe('Date TBC');
  });
});

describe('localDay', () => {
  it('gives the local calendar day of a time', () => {
    const d = new Date(2026, 9, 14, 4, 30); // 14 Oct 2026, 04:30 local
    expect(localDay(d.toISOString())).toBe('2026-10-14');
  });
  it('is empty for a missing or invalid time', () => {
    expect(localDay(null)).toBe('');
    expect(localDay('not a date')).toBe('');
  });
});

import { matchPhase } from '../shared/when';
describe('matchPhase', () => {
  const at = (h: number) => new Date(Date.UTC(2026, 9, 13, 12) - h * 3600e3).toISOString(); // a start time h hours before "now"
  const now = Date.UTC(2026, 9, 13, 12);
  it('is upcoming before the start', () => expect(matchPhase({ status: 'Scheduled', starts_at: at(-3), format: 'T20' }, now)).toBe('upcoming'));
  it('is live in the first hours', () => expect(matchPhase({ status: 'Scheduled', starts_at: at(2), format: 'T20' }, now)).toBe('live'));
  it('is completed once a T20 should be long over, even if the feed never updated its status', () => expect(matchPhase({ status: 'Scheduled', starts_at: at(30), format: 'T20' }, now)).toBe('completed'));
  it('gives an ODI more time than a T20', () => expect(matchPhase({ status: 'Scheduled', starts_at: at(7), format: 'ODI' }, now)).toBe('live'));
  it('trusts a result in the status text', () => expect(matchPhase({ status: 'Sri Lanka won by 8 wkts', starts_at: at(1), format: 'T20' }, now)).toBe('completed'));
  it('treats a match with no start time as upcoming', () => expect(matchPhase({ status: null, starts_at: null, format: 'T20' }, now)).toBe('upcoming'));
});
