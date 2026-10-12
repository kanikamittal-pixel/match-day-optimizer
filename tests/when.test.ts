import { describe, expect, it } from 'vitest';
import { countdown, dayLabel } from '../shared/when';

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
