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

/**
 * Like matchStrict, but each roster player may also be known by aliases (full names from Cricsheet's register,
 * e.g. "MD Shanaka" is also "Dasun Shanaka" / "D Shanaka"). A short Dream11 name matches a player if it
 * strictly matches the player's name OR any alias, and exactly ONE player qualifies. Two hits means we refuse.
 */
export function matchStrictAliases(input: string, roster: string[], aliases: Record<string, string[]>): string | null {
  const hits = new Set<string>();
  for (const canon of new Set(roster)) {
    const texts = [canon, ...(aliases[canon] ?? [])];
    if (texts.some((t) => matchStrict(input, [t]) !== null)) hits.add(canon);
  }
  return hits.size === 1 ? [...hits][0] : null;
}

/**
 * Safety net: if two different squad players were linked to the SAME historical player, at least one link is
 * wrong (e.g. two "K Mendis" where only one has a known alias). Drop every link in such a clash.
 */
export function dropSharedLinks(link: Map<string, string>): { kept: Map<string, string>; dropped: string[] } {
  const count = new Map<string, number>();
  for (const full of link.values()) count.set(full, (count.get(full) ?? 0) + 1);
  const kept = new Map<string, string>();
  const dropped: string[] = [];
  for (const [key, full] of link) {
    if (count.get(full)! > 1) dropped.push(key);
    else kept.set(key, full);
  }
  return { kept, dropped };
}

/**
 * Fixture feeds say "Sydney Sixers Women"; Cricsheet files the same side as "Sydney Sixers" with gender = female.
 * Returns the names to look up and which gender's matches to read.
 */
export function teamLookup(team: string): { names: string[]; gender: 'male' | 'female' } {
  const women = /\bwomen('s)?\b|\bW\b\s*$/i.test(team);
  const base = team.replace(/\s+(women('s)?|w)\s*$/i, '').trim();
  return { names: [...new Set([team, base])], gender: women ? 'female' : 'male' };
}

/**
 * Are two written names plausibly the same player? Built for comparing Dream11 short names with each other
 * ("K Mendis" vs "K Mendis (WK)", "M Theekshan..." vs "M Theeks"): same first initial, and one surname is the other
 * or a prefix of it (so truncated names still match). A "(WK)"-style suffix is ignored.
 */
export function sameShortName(a: string, b: string): boolean {
  const clean = (x: string) => tokens(x.replace(/(…|\.\.\.)/g, ' '));
  const ta = clean(a), tb = clean(b);
  if (!ta.length || !tb.length) return false;
  const sa = ta[ta.length - 1], sb = tb[tb.length - 1];
  const surnameOk = sa === sb || (Math.min(sa.length, sb.length) >= 4 && (sa.startsWith(sb) || sb.startsWith(sa)));
  const ia = ta.length > 1 ? ta[0][0] : '', ib = tb.length > 1 ? tb[0][0] : '';
  return surnameOk && (!ia || !ib || ia === ib);
}

/**
 * Pair every name read from a screenshot with a different recommended name (each used at most once, so two
 * "K Mendis" are paired with two different players). Returns the pairing and what is left over on each side.
 */
export function pairNames(read: string[], recommended: string[], extra?: (r: string, rec: string) => boolean): { paired: { read: string; rec: string }[]; unmatchedRead: string[]; missing: string[] } {
  const used = new Set<string>(); // recommended entries already taken
  const taken = new Array<string | null>(read.length).fill(null); // by position, so duplicate names pair separately
  const test = (r: string, c: string) => sameShortName(r, c) || (extra ? extra(r, c) : false);
  const exact = (r: string, c: string) => r.toLowerCase().replace(/[^a-z]/g, '') === c.toLowerCase().replace(/[^a-z]/g, '');
  const pass = (ok: (r: string, c: string) => boolean) => {
    read.forEach((r, i) => {
      if (taken[i] !== null) return;
      const c = recommended.find((x) => !used.has(x) && ok(r, x));
      if (c) { taken[i] = c; used.add(c); }
    });
  };
  pass(exact); pass(test);
  return {
    paired: read.flatMap((r, i) => (taken[i] === null ? [] : [{ read: r, rec: taken[i] as string }])),
    unmatchedRead: read.filter((_, i) => taken[i] === null),
    missing: recommended.filter((c) => !used.has(c)),
  };
}
