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
