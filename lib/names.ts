export function nameKey(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function tokens(s: string): string[] {
  return s
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
