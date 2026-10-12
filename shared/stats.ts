/** Small, dependency-free statistics used by the baseline comparison in Insights. */
export const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);

function ranks(xs: number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array(xs.length).fill(0);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; // ties share the average rank
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

/** Spearman rank correlation: do two scorings put the same players on top? NaN when undefined. */
export function spearman(x: number[], y: number[]): number {
  if (x.length < 3 || x.length !== y.length) return NaN;
  const a = ranks(x), b = ranks(y);
  const ma = mean(a), mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : NaN;
}

/** 95% bootstrap confidence interval for the mean of `xs` (deterministic: seeded generator). */
export function bootstrapCI(xs: number[], resamples = 2000, seed = 12345): [number, number] {
  if (xs.length < 2) return [NaN, NaN];
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let t = 0;
    for (let i = 0; i < xs.length; i++) t += xs[Math.floor(rnd() * xs.length)];
    means.push(t / xs.length);
  }
  means.sort((a, b) => a - b);
  return [means[Math.floor(0.025 * resamples)], means[Math.floor(0.975 * resamples) - 1]];
}
