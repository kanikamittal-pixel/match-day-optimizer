/** Recent form built from this app's own saved results (actual fantasy points per match). */
export interface FormRow {
  key: string;
  points: number;
  when: string; // ISO date of the match
}

export interface Form {
  n: number;
  points: number[]; // newest first, at most 10
  avg: number;
}

export const FORM_WINDOW = 10;
/** Below this many matches the average is too noisy to weigh against career numbers. */
export const FORM_MIN = 3;

export function summariseForm(rows: FormRow[]): Record<string, Form> {
  const by = new Map<string, FormRow[]>();
  for (const r of rows) by.set(r.key, [...(by.get(r.key) ?? []), r]);
  const out: Record<string, Form> = {};
  for (const [key, rs] of by) {
    const pts = rs.sort((a, b) => b.when.localeCompare(a.when)).slice(0, FORM_WINDOW).map((r) => r.points);
    out[key] = { n: pts.length, points: pts, avg: Math.round((pts.reduce((s, x) => s + x, 0) / pts.length) * 10) / 10 };
  }
  return out;
}

export function formLine(f?: Form): string {
  if (!f || !f.n) return 'Last 10: no history in this app yet';
  return `Last ${f.n} in this app: ${f.points.join(' · ')} (avg ${f.avg})${f.n < FORM_MIN ? ' · too few to weigh' : ''}`;
}


/** What we know about one player's fantasy history from stored data (Cricsheet, else this app's own results). */
export interface PlayerHistory {
  found: boolean;
  source: 'cricsheet' | 'app' | 'none';
  cs_name?: string;
  n_all?: number;
  mean_all?: number;
  n_recent?: number;
  recent?: number[]; // newest first, at most 10
  mean_recent?: number; // recency-weighted average of the last 20 matches: the "recent" half of the base
  mean_last10?: number; // plain average of the 10 scores shown
  base?: number; // expected points before conditions, blended in code
  basis?: string;
  note?: string;
}

/** Label of the expected-points logic, stored with every back-test so before/after can be compared. */
export const LOGIC_VERSION = 'v2';
export const LOGIC_NAME = 'v2: 50% career average + 50% recency-weighted recent average; small-sample mix for players with 1-4 earlier matches; captain safety net';

export const LEGACY_LOGIC_NAME = 'v1: 50% career average + 50% flat last-10 average, no small-sample mix, no captain safety net';

export const MIN_ALL = 5;
export const MIN_RECENT = 3;
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Recency-weighted average of fantasy scores, NEWEST FIRST: the last `window` matches, each match counting half as
 * much as the one five matches newer (half-life 5). In a back-test of 1,236 matches this beat a flat last-10 average.
 */
export function ewmMean(newestFirst: number[], window = 20, halfLife = 5): number {
  const xs = newestFirst.slice(0, window);
  let w = 0, sum = 0;
  xs.forEach((x, i) => { const wi = Math.pow(0.5, i / halfLife); w += wi; sum += wi * x; });
  return w ? sum / w : NaN;
}

/**
 * Typical Dream11 T20 score of a player by how many earlier matches he has on record, measured over 6,000+ player-matches
 * in 2026 using only earlier data. Used to steady the average of players who have played very little.
 */
export const EXPERIENCE_PRIOR: { lo: number; hi: number; mean: number }[] = [
  { lo: 1, hi: 2, mean: 37.3 },
  { lo: 3, hi: 4, mean: 40.8 },
];
/** In the back-test, "own average counts 2-to-1 against the typical score" had the smallest error for 1-4 earlier matches. */
export const SMALL_SAMPLE_WEIGHT = 2;

/**
 * Equal weight: 50% overall (career average) + 50% recent (recency-weighted). With fewer than 5 earlier matches the
 * player's own average is mixed with the typical score for that experience instead. If only one half is reliable, that
 * half alone is used and the card says so.
 */
export function blendBase(h: { n_all?: number; mean_all?: number; n_recent?: number; mean_recent?: number }): { base: number; basis: string } | null {
  const n = h.n_all ?? 0;
  if (n >= 1 && n < MIN_ALL && h.mean_all !== undefined) {
    const prior = EXPERIENCE_PRIOR.find((p) => n >= p.lo && n <= p.hi)!.mean;
    return { base: r1((n * h.mean_all + SMALL_SAMPLE_WEIGHT * prior) / (n + SMALL_SAMPLE_WEIGHT)), basis: `only ${n} earlier match${n === 1 ? '' : 'es'}: own average mixed with the typical new-player score (${prior})` };
  }
  const allOk = n >= MIN_ALL && h.mean_all !== undefined;
  const recOk = (h.n_recent ?? 0) >= MIN_RECENT && h.mean_recent !== undefined;
  if (allOk && recOk) return { base: r1(0.5 * h.mean_all! + 0.5 * h.mean_recent!), basis: '50% overall + 50% recent' };
  if (allOk) return { base: r1(h.mean_all!), basis: 'overall only (too few recent matches)' };
  if (recOk) return { base: r1(h.mean_recent!), basis: 'recent only (too few overall matches)' };
  return null;
}

export function historyLine(h?: PlayerHistory): string {
  if (!h?.found) return h?.note ?? 'No fantasy history found';
  const parts: string[] = [];
  if (h.n_all) parts.push(`Career avg ${h.mean_all} (${h.n_all} T20s)`);
  if (h.n_recent) parts.push(`Last ${h.recent!.length}: ${h.recent!.join(' · ')} (avg ${h.mean_last10 ?? h.mean_recent})`);
  return parts.join(' · ') || 'No fantasy history found';
}

export function partsLine(base?: number | null, adj?: number | null): string | null {
  if (base === undefined || base === null) return null;
  const a = adj ?? 0;
  return `Base ${base}${a ? ` ${a > 0 ? '+' : '−'} ${Math.abs(a)} conditions` : ''}`;
}


/** The ORIGINAL base (version 1). Kept only so back-tests can re-run the old logic for a fair before/after. */
export function blendBaseLegacy(h: { n_all?: number; mean_all?: number; n_recent?: number; mean_recent?: number }): { base: number; basis: string } | null {
  const allOk = (h.n_all ?? 0) >= MIN_ALL && h.mean_all !== undefined;
  const recOk = (h.n_recent ?? 0) >= MIN_RECENT && h.mean_recent !== undefined;
  if (allOk && recOk) return { base: r1(0.5 * h.mean_all! + 0.5 * h.mean_recent!), basis: '50% overall + 50% recent (v1)' };
  if (allOk) return { base: r1(h.mean_all!), basis: 'overall only (v1)' };
  if (recOk) return { base: r1(h.mean_recent!), basis: 'recent only (v1)' };
  return null;
}
