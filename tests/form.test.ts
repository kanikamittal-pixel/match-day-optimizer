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
