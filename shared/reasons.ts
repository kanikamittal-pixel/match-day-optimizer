/**
 * Rejects generic reasons. A reason passes only if it contains NO banned filler phrase and
 * cites something match-specific: a number, the venue/opposition, or a conditions/role keyword.
 */
const BANNED = [
  /\bin (good|great|red-hot|fine|top) form\b/i,
  /\bgood form\b/i,
  /\bgreat form\b/i,
  /\bhas been (performing|playing) (well|good)\b/i,
  /\bconsistent performer\b/i,
  /\bkey player\b/i,
  /\breliable (player|option)\b/i,
  /\bsolid option\b/i,
  /\bhandy (player|option)\b/i,
  /\bshould perform well\b/i,
  /\bexpected to do well\b/i,
  /\bmatch[- ]winner\b/i,
  /\bin-form\b/i,
];

const ANCHOR_WORDS =
  /\b(pitch|surface|dew|powerplay|death|middle overs|opener|opening|no\.?\s?\d|number \d|spin|spinner|pace|seam|swing|bounce|turn|boundary|boundaries|chase|chasing|defend|first innings|second innings|average|avg|strike rate|sr|economy|wickets?|runs?|vs\.?|against|at this ground|home|dimension|short side|slow|low|flat|humid|overcast|left-?arm|leg-?spin|off-?spin|yorker)\b/i;

export interface ReasonContext {
  venue?: string | null;
  teams: string[];
}

export function isGenericReason(reason: string, ctx: ReasonContext): boolean {
  const r = (reason ?? '').trim();
  if (r.length < 15) return true;
  if (BANNED.some((re) => re.test(r))) return true;
  if (/\d/.test(r)) return false;
  const lower = r.toLowerCase();
  const names = [ctx.venue ?? '', ...ctx.teams]
    .flatMap((s) => s.split(/[\s,]+/))
    .map((s) => s.toLowerCase())
    .filter((s) => s.length > 3);
  if (names.some((n) => lower.includes(n))) return false;
  return !ANCHOR_WORDS.test(r);
}

export function findGeneric(items: { name: string; reason: string }[], ctx: ReasonContext): string[] {
  return items.filter((i) => isGenericReason(i.reason, ctx)).map((i) => i.name);
}
