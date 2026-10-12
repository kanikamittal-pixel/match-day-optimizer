import { handle, HttpError } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { loadMatch } from '@/backend/db/queries';
import { gemini, parseJson, S } from '@/backend/integrations/gemini';
import { nameKey } from '@/shared/names';


export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const m = await loadMatch(sb, id);
  const { images } = (await req.json()) as { images: { mime: string; data: string }[] };
  if (!images?.length || images.length > 3) throw new HttpError(400, 'Upload 1 to 3 screenshots.');

  const schema = S.obj({
    players: S.arr(S.obj({ name: S.str, team: S.str, role: S.enum(['WK', 'BAT', 'AR', 'BOWL']), credit: { type: 'NUMBER', nullable: true }, in_main_list: { type: 'BOOLEAN' } })),
  });
  const { text } = await gemini({
    schema,
    temperature: 0,
    images,
    prompt: `These are screenshots from the Dream11 app for ${m.team_a} vs ${m.team_b}. They may be the player-selection list, the team preview, the captain/vice-captain screen, or a saved team. Extract EVERY player visible across all images (dedupe repeats).
For each: name (as shown), team (must be exactly "${m.team_a}" or "${m.team_b}", map team codes/abbreviations to these), role as one of WK, BAT, AR, BOWL (from the small role label under each player's number: WK=wicket-keeper, BAT=batter, ALL or AR=all-rounder, BOWL=bowler). Include the players in both the main list and the \"Others\" section. Names may be shortened (e.g. \"S Jayawarde…\"): copy what is shown without the ellipsis, credit (number such as 9.5).
in_main_list: true if the player is in the main list above the \"Others\" divider (the list headed \"Played Last Match\", i.e. the probable playing XI); false if the player is under the \"Others\" heading. If the screenshot has no such divider, set true for every player.
IMPORTANT: Dream11 often hides credits until 11 players are picked. If a player's credit is NOT visible on screen, set credit to null. Never guess or estimate a credit. Do not invent players that are not visible.`,
  });
  const out = parseJson<{ players: { name: string; team: string; role: string; credit: number | null; in_main_list?: boolean }[] }>(text);

  // Two different players can share a shortened name (e.g. two "K Mendis"). Tell them apart so both survive.
  const seenKey = new Map<string, number>();
  for (const p of out.players) {
    const k = `${p.team}|${nameKey(p.name)}`;
    seenKey.set(k, (seenKey.get(k) ?? 0) + 1);
  }
  const used = new Set<string>();
  for (const p of out.players) {
    const k = `${p.team}|${nameKey(p.name)}`;
    if ((seenKey.get(k) ?? 0) > 1) {
      let label = `${p.name} (${p.role})`;
      let n = 2;
      while (used.has(`${p.team}|${nameKey(label)}`)) label = `${p.name} (${p.role} ${n++})`;
      p.name = label;
    }
    used.add(`${p.team}|${nameKey(p.name)}`);
  }

  const keys = out.players.map((p) => nameKey(p.name));
  const prev = must(await sb.from('players').select('name_key,last_credit').in('name_key', keys), 'prev credits') as { name_key: string; last_credit: number | null }[];
  const prevMap = new Map(prev.map((p) => [p.name_key, p.last_credit === null ? null : Number(p.last_credit)]));
  const rows = out.players.map((p) => {
    const before = prevMap.get(nameKey(p.name)) ?? null;
    // Credit hidden on screen: fall back to the player's last known credit (flagged to verify), else leave blank.
    const probable = p.in_main_list !== false;
    if (p.credit === null || p.credit === undefined) return { ...p, probable, credit: before ?? '', prev_credit: before, changed: before !== null, assumed: before !== null };
    return { ...p, probable, prev_credit: before, changed: before !== null && before !== p.credit, assumed: false };
  });
  return { rows };
});
