export function nameKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function tokens(s: string): string[] {
  return s
    .replace(/\(.*?\)/g, ' ') // "K Mendis (WK)" -> "K Mendis"
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Match a free-typed name ("V Kohli", "kohli") to one of the known players. Returns the key or null. */
export function matchName(input: string, known: { key: string; name: string }[]): string | null {
  const k = nameKey(input);
  if (!k) return null;
  const exact = known.find((p) => p.key === k);
  if (exact) return exact.key;
  const t = tokens(input);
  const last = t[t.length - 1];
  const initial = t[0]?.[0];
  const sameLast = known.filter((p) => {
    const pt = tokens(p.name);
    return pt[pt.length - 1] === last;
  });
  if (sameLast.length === 1) return sameLast[0].key;
  if (sameLast.length > 1 && t.length > 1) {
    const byInitial = sameLast.filter((p) => tokens(p.name)[0]?.[0] === initial);
    if (byInitial.length === 1) return byInitial[0].key;
  }
  return null;
}

/**
 * Strict identity match for linking a short Dream11 name ("S Farhan", "C Wickramas…") to a full name inside ONE team's
 * roster. Requires the same surname (or the shown prefix of it) AND the same first initial, and exactly one hit.
 * Returns null rather than guessing, because showing another player's history is worse than none.
 */
export function matchStrict(input: string, fullNames: string[]): string | null {
  const truncated = /(…|\.\.\.)\s*$/.test(input.trim());
  const t = tokens(input.replace(/(…|\.\.\.)/g, ''));
  if (!t.length) return null;
  const sur = t[t.length - 1];
  const initial = t.length > 1 ? t[0][0] : '';
  const hits = [...new Set(fullNames)].filter((n) => {
    const nt = tokens(n);
    if (nt.length < 1) return false;
    const last = nt[nt.length - 1];
    const surOk = truncated ? last.startsWith(sur) && sur.length >= 3 : last === sur;
    return surOk && (!initial || nt[0][0] === initial);
  });
  return hits.length === 1 ? hits[0] : null;
}
