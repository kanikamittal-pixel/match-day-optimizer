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

/**
 * Two players on the same side must never end up with the same history name (it would merge two people, and a database
 * batch with a repeated key fails). Where scorecard players clash after name matching, each keeps its own scorecard name;
 * if those clash too, a number is added.
 */
export function uniqueCanon(entries: { team: string; name: string; canon: string }[]): string[] {
  const count = new Map<string, number>();
  for (const e of entries) count.set(`${e.team}|${nameKey(e.canon)}`, (count.get(`${e.team}|${nameKey(e.canon)}`) ?? 0) + 1);
  const used = new Set<string>();
  return entries.map((e) => {
    let c = (count.get(`${e.team}|${nameKey(e.canon)}`) ?? 0) > 1 ? e.name : e.canon;
    let n = 2;
    while (used.has(`${e.team}|${nameKey(c)}`)) c = `${e.name} (${n++})`;
    used.add(`${e.team}|${nameKey(c)}`);
    return c;
  });
}

function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...new Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/**
 * Link the names of an announced playing XI ("Chamindu Wickramasinghe") to the squad list, whose names are Dream11-style
 * short or truncated names ("C Wickra", "S Arachch", two players called "K Mendis"). Each squad player is used once.
 *  1. Same first initial and the same or a truncated surname (see sameShortName).
 *  2. A name that fits several squad players is only linked when exactly that many announced names fit them (so two
 *     announced Mendis take the two "K Mendis"); otherwise it is left for a person to decide, never guessed.
 *  3. A spelling variant ("Moqim" for "Muqeem") is linked only if it is the clearly closest, unique surname among the
 *     squad players left over, with the same first initial. These are reported in `guessed` so they can be checked.
 */
export function mapAnnounced(announced: string[], pool: { key: string; name: string }[]): { keys: string[]; pairs: { announced: string; key: string }[]; unmatched: string[]; guessed: { announced: string; matched: string }[] } {
  const keyOf = new Map<number, string>();
  const used = new Set<string>();
  const cands = announced.map((a) => pool.filter((p) => sameShortName(a, p.name)).map((p) => p.key));
  const take = (i: number, key: string) => { keyOf.set(i, key); used.add(key); };

  // 1 + 2, repeated until nothing changes (one link can free up the next)
  for (let changed = true; changed; ) {
    changed = false;
    announced.forEach((_, i) => {
      if (keyOf.has(i)) return;
      const free = cands[i].filter((k) => !used.has(k));
      if (free.length === 1) { take(i, free[0]); changed = true; return; }
      if (free.length > 1) {
        const same = announced.map((__, j) => j).filter((j) => !keyOf.has(j) && cands[j].filter((k) => !used.has(k)).sort().join() === free.slice().sort().join());
        if (same.length === free.length) { same.forEach((j, n) => take(j, free[n])); changed = true; }
      }
    });
  }

  // 3: unique closest surname among what is left
  const guessed: { announced: string; matched: string }[] = [];
  announced.forEach((a, i) => {
    if (keyOf.has(i)) return;
    const ta = tokens(a); if (ta.length < 2) return;
    const sa = ta[ta.length - 1];
    const scored = pool.filter((p) => !used.has(p.key)).map((p) => {
      const tp = tokens(p.name); const sp = tp[tp.length - 1] ?? '';
      const ok = tp.length > 1 && tp[0][0] === ta[0][0];
      return { p, sim: ok ? 1 - editDistance(sa, sp) / Math.max(sa.length, sp.length) : 0 };
    }).sort((x, y) => y.sim - x.sim);
    if (scored[0] && scored[0].sim >= 0.5 && (!scored[1] || scored[0].sim - scored[1].sim >= 0.15)) {
      take(i, scored[0].p.key);
      guessed.push({ announced: a, matched: scored[0].p.name });
    }
  });

  return { keys: announced.flatMap((_, i) => (keyOf.has(i) ? [keyOf.get(i) as string] : [])), pairs: announced.flatMap((n, i) => (keyOf.has(i) ? [{ announced: n, key: keyOf.get(i) as string }] : [])), unmatched: announced.filter((_, i) => !keyOf.has(i)), guessed };
}

/** Two first names that are both spelled out must agree ("Kamindu" is not "Kusal"); an initial agrees with anything starting with it. */
function firstNamesAgree(a: string, b: string): boolean {
  const fa = tokens(a)[0] ?? '', fb = tokens(b)[0] ?? '';
  if (fa.length < 3 || fb.length < 3) return true;
  return fa.startsWith(fb) || fb.startsWith(fa) || (Math.min(fa.length, fb.length) >= 4 && editDistance(fa, fb) <= 1); // "Hasan" and "Hassan" are one person
}

/**
 * Link squad players to the names Cricsheet uses (inside ONE team's roster). Each player may come with several
 * spellings, best first (a full name from the announced XI, then the short Dream11 name). Strict, in three steps:
 *  1. Surname + first initial, also against Cricsheet's alternative spellings (matchStrictAliases), exactly one hit.
 *  2. A full name whose words all appear in a roster name ("Mohammad Imran" in "Mohammad Imran Randhawa"), one hit.
 *  3. A full first name whose initial is inside Cricsheet's initials ("Kamindu" has K, "PHKD Mendis" has K), counting
 *     only roster names not already taken by another squad player, and only if exactly one is left.
 * Never guesses: anything still ambiguous gets no link, because another player's history is worse than none.
 */
export function linkRoster(players: { key: string; names: string[] }[], roster: string[], aliases: Record<string, string[]>): Map<string, string> {
  const links = new Map<string, string>();
  const taken = () => new Set(links.values());
  const rosterSet = [...new Set(roster)];

  // 1. strict surname + initial
  // a spelled-out name is more exact than a short one: when a player has one, only that name is used for linking
  const best = (p: { names: string[] }) => p.names.filter((n) => (tokens(n)[0] ?? '').length >= 3 && tokens(n).length > 1).slice(0, 1).concat(p.names).slice(0, 1);
  for (const p of players) for (const n of best(p)) {
    const hits = rosterSet.filter((c) => [c, ...(aliases[c] ?? [])].some((x) => matchStrict(n, [x]) !== null && firstNamesAgree(n, x)));
    if (hits.length === 1) { links.set(p.key, hits[0]); break; }
  }

  // 2. every word of a full name is inside a roster name (or one of its alternative spellings)
  for (const p of players) {
    if (links.has(p.key)) continue;
    for (const n of p.names) {
      const t = tokens(n);
      if (t.length < 2 || t.some((w) => w.length < 3)) continue; // only real full names
      const hits = rosterSet.filter((c) => [c, ...(aliases[c] ?? [])].some((x) => { const xt = tokens(x); return t.every((w) => xt.includes(w)); }));
      if (hits.length === 1 && !taken().has(hits[0])) { links.set(p.key, hits[0]); break; }
    }
  }

  // 3. first initial found inside the initials block, by elimination
  const free = (p: { key: string; names: string[] }) => {
    for (const n of p.names) {
      const t = tokens(n);
      if (t.length < 2 || t[0].length < 3) continue; // needs a full first name
      const sur = t[t.length - 1];
      const hits = rosterSet.filter((c) => {
        if (taken().has(c)) return false;
        const ct = c.split(/\s+/);
        const block = ct[0];
        return ct.length >= 2 && /^[A-Z]{1,5}$/.test(block) && tokens(ct[ct.length - 1]).join('') === sur && block.toLowerCase().includes(t[0][0]);
      });
      if (hits.length) return hits;
    }
    return [] as string[];
  };
  for (let changed = true; changed; ) {
    changed = false;
    const open = players.filter((p) => !links.has(p.key));
    for (const p of open) {
      const hits = free(p);
      if (hits.length !== 1) continue;
      // another still-unlinked player must not be able to claim the same name
      if (open.some((q) => q.key !== p.key && free(q).includes(hits[0]))) continue;
      links.set(p.key, hits[0]); changed = true;
    }
  }
  // 4. nothing found with the spelled-out name (a spelling that differs from Cricsheet's): try the short name, but only for a
  //    history name no other squad player already holds
  for (const p of players) {
    if (links.has(p.key)) continue;
    for (const n of p.names.slice(1)) {
      const hits = rosterSet.filter((c) => [c, ...(aliases[c] ?? [])].some((x) => matchStrict(n, [x]) !== null && firstNamesAgree(n, x)));
      if (hits.length === 1 && !taken().has(hits[0])) { links.set(p.key, hits[0]); break; }
    }
  }
  return dropSharedLinks(links).kept; // two squad players on one history name means at least one link is wrong: drop both
}
