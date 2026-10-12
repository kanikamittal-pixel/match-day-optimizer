import { handle, HttpError } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { gemini, parseJson, S } from '@/backend/integrations/gemini';
import { loadAliases } from '@/backend/services/cricsheet-ingest';
import { matchStrictAliases, pairNames, sameShortName } from '@/shared/names';

export const maxDuration = 60;

interface RecPlayer { name: string; role: string; team: string }
interface Item {
  key: string;
  kind: 'live' | 'backtest';
  title: string;
  date: string | null;
  recommendedAt: string;
  stage?: string;
  recommended: { xi: RecPlayer[]; captain: string; vc: string };
  final?: { xi: RecPlayer[]; captain: string; vc: string } | null; // Aryan's final team when it differs
  note?: string;
  proof: any | null;
  log: { at: string; stage: string; captain: string; vc: string; xi: string[] }[];
}

/** Everything the agent recommended, frozen with the time it was made, plus any screenshot proof uploaded for it. */
async function buildItems(sb: any): Promise<Item[]> {
  const items: Item[] = [];

  const decisions = must(await sb.from('team_decisions').select('match_id,stage,recommended,final,decisions,created_at'), 'decisions') as any[];
  const ids = decisions.map((d) => d.match_id);
  const matches = ids.length ? (must(await sb.from('matches').select('id,name,starts_at,team_a,team_b').in('id', ids), 'matches') as any[]) : [];
  const credits = ids.length ? (must(await sb.from('match_credits').select('match_id,name_key,name,team,role').in('match_id', ids), 'credits') as any[]) : [];
  const { data: cache } = await sb.from('api_cache').select('key,payload,fetched_at').or('key.like.proof:*,key.like.rec:*,key.like.bt:%');
  const rows = (cache ?? []) as { key: string; payload: any; fetched_at: string }[];

  for (const d of decisions) {
    const m = matches.find((x) => x.id === d.match_id);
    if (!m) continue;
    const by = new Map(credits.filter((c) => c.match_id === d.match_id).map((c) => [c.name_key, c]));
    const pl = (k: string): RecPlayer => ({ name: by.get(k)?.name ?? k, role: by.get(k)?.role ?? '', team: by.get(k)?.team ?? '' });
    const rec = d.recommended, fin = d.final;
    const changed = JSON.stringify([...fin.xi].sort()) !== JSON.stringify([...rec.xi].sort()) || fin.captain !== rec.captain || fin.vc !== rec.vc;
    items.push({
      key: `m:${d.match_id}`, kind: 'live', title: m.name, date: m.starts_at, recommendedAt: d.created_at, stage: d.stage,
      recommended: { xi: rec.xi.map(pl), captain: pl(rec.captain).name, vc: pl(rec.vc).name },
      final: changed ? { xi: fin.xi.map(pl), captain: pl(fin.captain).name, vc: pl(fin.vc).name } : null,
      note: changed ? `Aryan changed ${(d.decisions ?? []).length} thing(s) after the recommendation.` : 'Aryan kept the recommendation as it was.',
      proof: rows.find((r) => r.key === `proof:m:${d.match_id}`)?.payload ?? null,
      log: rows.filter((r) => r.key.startsWith(`rec:${d.match_id}:`)).map((r) => r.payload).sort((a, b) => String(b.at).localeCompare(String(a.at))),
    });
  }

  // matches that had already finished: the team built BEFORE reading the result, with the date it was built
  const bt = rows.filter((r) => /^bt:[^:]+:v\d+$/.test(r.key)).map((r) => r.payload);
  const byRef = new Map<string, any>();
  for (const r of bt) if (!byRef.has(r.ref) || String(r.logic) > String(byRef.get(r.ref).logic)) byRef.set(r.ref, r);
  for (const r of byRef.values()) {
    const pl = (n: string): RecPlayer => { const p = r.players.find((x: any) => x.name === n); return { name: n, role: p?.role ?? '', team: p?.team ?? '' }; };
    items.push({
      key: `bt:${r.ref}`, kind: 'backtest', title: `${r.title} (already played)`, date: r.date, recommendedAt: r.createdAt,
      recommended: { xi: r.agent.xi.map(pl), captain: r.agent.captain, vc: r.agent.vc },
      note: `Built before reading the result, using only earlier matches. It scored ${r.metrics.agent} points against a best possible ${r.metrics.hindsight}.`,
      proof: rows.find((x) => x.key === `proof:bt:${r.ref}`)?.payload ?? null, log: [],
    });
  }
  items.sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')));
  return items;
}

export const GET = handle(async () => {
  const { sb } = await requireUser();
  return { items: await buildItems(sb) };
});

/** Read a Dream11 team screenshot and check it against what was recommended. Stores the screenshot as evidence. */
export const POST = handle(async (req: Request) => {
  const { sb } = await requireUser();
  const { key, images, which } = (await req.json()) as { key: string; images: { mime: string; data: string }[]; which?: 'recommended' | 'final' };
  if (!key || !images?.length || images.length > 3) throw new HttpError(400, 'Send 1 to 3 screenshots.');
  if (images.some((i) => i.data.length > 700_000)) throw new HttpError(413, 'A screenshot is too large. Try again; the page shrinks images before uploading.');

  const list = await buildItems(sb);
  const item = list.find((i) => i.key === key);
  if (!item) throw new HttpError(404, 'Unknown match.');
  const target = which === 'final' && item.final ? item.final : item.recommended;

  const schema = S.obj({
    players: S.arr(S.obj({ name: S.str })),
    captain: { type: 'STRING', nullable: true },
    vice_captain: { type: 'STRING', nullable: true },
  });
  const { text } = await gemini({
    schema, temperature: 0, images,
    prompt: `These are screenshots of a Dream11 fantasy cricket team (the preview, the captain screen or "My Teams"). List the 11 selected players exactly as their names are shown, and the names of the player with the C (captain) badge and the VC (vice-captain) badge if they are visible. If a badge is not visible, return null for it. Do not invent anything that is not on screen.`,
  });
  const read = parseJson<{ players: { name: string }[]; captain: string | null; vice_captain: string | null }>(text);
  const aliases = await loadAliases(sb);
  const roster = target.xi.map((p) => p.name);
  // Pair each name on the screenshot with a different recommended player (tolerant of truncation and "(WK)" suffixes;
  // full Cricsheet names for back-tests are handled through the alias list)
  const viaAlias = (r: string, c: string) => matchStrictAliases(r, [c], aliases) === c;
  const pairing = pairNames(read.players.map((p) => p.name), roster, viaAlias);
  const matched = new Set(pairing.paired.map((x) => x.rec));
  const unmatched = pairing.unmatchedRead;
  const missing = pairing.missing;
  const same = (readName: string | null, rec: string) => (readName ? sameShortName(readName, rec) || viaAlias(readName, rec) : false);
  const capRead = read.captain && same(read.captain, target.captain) ? target.captain : null;
  const vcRead = read.vice_captain && same(read.vice_captain, target.vc) ? target.vc : null;
  const result = {
    checkedAt: new Date().toISOString(), against: which === 'final' ? 'final' : 'recommended',
    read: read.players.length, matched: matched.size, total: roster.length, missing, unmatched,
    captain: { read: read.captain, ok: read.captain ? capRead !== null : null },
    vc: { read: read.vice_captain, ok: read.vice_captain ? vcRead !== null : null },
    exact: matched.size === roster.length && read.players.length === roster.length,
  };
  const prev = (await sb.from('api_cache').select('payload').eq('key', `proof:${key}`).maybeSingle()).data?.payload;
  const stored = { images: [...(prev?.images ?? []), ...images.map((i) => `data:${i.mime};base64,${i.data}`)].slice(-3), results: [result, ...(prev?.results ?? [])].slice(0, 6) };
  must(await sb.from('api_cache').upsert({ key: `proof:${key}`, payload: stored, fetched_at: new Date().toISOString(), ttl_seconds: 3650 * 86400 }), 'save proof');
  return { result, proof: stored };
});
