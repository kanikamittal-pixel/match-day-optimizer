import { describe, expect, it } from 'vitest';
import { bootstrapCI, mean, spearman } from '../shared/stats';

describe('spearman', () => {
  it('is 1 for the same order, -1 for the reverse, and handles ties', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
    expect(spearman([1, 2, 2, 4], [1, 2, 2, 4])).toBeCloseTo(1);
    expect(spearman([5, 5, 5], [1, 2, 3])).toBeNaN();
  });
});

describe('bootstrapCI', () => {
  it('contains the mean and excludes 0 for a clearly positive sample', () => {
    const xs = Array.from({ length: 60 }, (_, i) => 2 + ((i * 7) % 5) * 0.2);
    const [lo, hi] = bootstrapCI(xs);
    expect(lo).toBeLessThan(mean(xs));
    expect(hi).toBeGreaterThan(mean(xs));
    expect(lo).toBeGreaterThan(0);
  });
  it('straddles 0 for noise around 0', () => {
    const xs = Array.from({ length: 40 }, (_, i) => (i % 2 ? 1 : -1) * ((i % 7) + 1));
    const [lo, hi] = bootstrapCI(xs);
    expect(lo).toBeLessThan(0);
    expect(hi).toBeGreaterThan(0);
  });
  it('is deterministic', () => {
    expect(bootstrapCI([1, 2, 3, 9])).toEqual(bootstrapCI([1, 2, 3, 9]));
  });
});
