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
  mean_recent?: number;
  base?: number; // expected points before conditions, blended in code
  basis?: string;
  note?: string;
}

export const MIN_ALL = 5;
export const MIN_RECENT = 3;
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Equal weight: 50% overall average + 50% recent average. If only one is reliable, that one alone (and we say so). */
export function blendBase(h: { n_all?: number; mean_all?: number; n_recent?: number; mean_recent?: number }): { base: number; basis: string } | null {
  const allOk = (h.n_all ?? 0) >= MIN_ALL && h.mean_all !== undefined;
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
  if (h.n_recent) parts.push(`Last ${h.n_recent}: ${h.recent!.join(' · ')} (avg ${h.mean_recent})`);
  return parts.join(' · ') || 'No fantasy history found';
}

export function partsLine(base?: number | null, adj?: number | null): string | null {
  if (base === undefined || base === null) return null;
  const a = adj ?? 0;
  return `Base ${base}${a ? ` ${a > 0 ? '+' : '−'} ${Math.abs(a)} conditions` : ''}`;
}
