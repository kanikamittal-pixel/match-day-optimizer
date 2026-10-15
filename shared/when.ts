/** Friendly time helpers for the dashboard (pure, so they can be tested). */
export function countdown(startIso: string | null, now = Date.now()): string {
  if (!startIso) return 'Start time TBC';
  const ms = new Date(startIso).getTime() - now;
  if (!Number.isFinite(ms)) return 'Start time TBC';
  if (ms <= 0) return 'Started';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
  if (d >= 1) return `Starts in ${d}d ${h}h`;
  if (h >= 1) return `Starts in ${h}h ${m}m`;
  return `Starts in ${m} min`;
}

/** "Today", "Tomorrow" or a short date, judged in the viewer's local time. */
export function dayLabel(iso: string | null, now = new Date()): string {
  if (!iso) return 'Date TBC';
  const d = new Date(iso);
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const tomorrow = new Date(now.getTime() + 86400000);
  if (sameDay(d, now)) return 'Today';
  if (sameDay(d, tomorrow)) return 'Tomorrow';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

/** The calendar day (YYYY-MM-DD) of a time, in the viewer's local time. Used by the date filter. */
export function localDay(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DONE = /\b(won by|won the match|match drawn|drawn|tied|no result|abandoned|match ended|completed|result)\b/i;

/**
 * Is a match upcoming, live or completed? The status text from the feed decides when it says so. Some feeds never update
 * their status ("Scheduled" forever), so a match is also treated as completed a few hours after its start: a T20 is over
 * within about 5 hours, an ODI within about 10, a Test after 5 days.
 */
export function matchPhase(m: { status: string | null; starts_at: string | null; format: string | null }, now = Date.now()): 'completed' | 'live' | 'upcoming' {
  if (m.status && DONE.test(m.status)) return 'completed';
  if (!m.starts_at) return 'upcoming';
  const start = new Date(m.starts_at).getTime();
  if (!Number.isFinite(start) || start > now) return 'upcoming';
  const hours = m.format === 'TEST' ? 5 * 24 : m.format === 'ODI' ? 10 : 5;
  return now - start > hours * 3600e3 ? 'completed' : 'live';
}
