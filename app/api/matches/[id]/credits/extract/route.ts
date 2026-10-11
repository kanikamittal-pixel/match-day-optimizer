import { handle, HttpError } from '@/lib/http';
import { must, requireUser } from '@/lib/supabase/server';
import { loadMatch } from '@/lib/data';
import { gemini, parseJson, S } from '@/lib/gemini';
import { nameKey } from '@/lib/names';

export const maxDuration = 60;

export const POST = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const m = await loadMatch(sb, id);
  const { images } = (await req.json()) as { images: { mime: string; data: string }[] };
  if (!images?.length || images.length > 3) throw new HttpError(400, 'Upload 1 to 3 screenshots.');

  const schema = S.obj({
    players: S.arr(S.obj({ name: S.str, team: S.str, role: S.enum(['WK', 'BAT', 'AR', 'BOWL']), credit: S.num })),
  });
  const { text } = await gemini({
    schema,
    temperature: 0,
    images,
    prompt: `These are screenshots of Dream11's "Create Team" screen for ${m.team_a} vs ${m.team_b}. Extract EVERY player visible across all images (dedupe repeats).
For each: name (as shown), team (must be exactly "${m.team_a}" or "${m.team_b}", map team codes/abbreviations to these), role as one of WK, BAT, AR, BOWL (from the tab/section: WK=wicket-keeper, BAT=batter, AR=all-rounder, BOWL=bowler), credit (number, e.g. 9.5).
Do not invent players that are not visible.`,
  });
  const out = parseJson<{ players: { name: string; team: string; role: string; credit: number }[] }>(text);

  const keys = out.players.map((p) => nameKey(p.name));
  const prev = must(await sb.from('players').select('name_key,last_credit').in('name_key', keys), 'prev credits') as { name_key: string; last_credit: number | null }[];
  const prevMap = new Map(prev.map((p) => [p.name_key, p.last_credit === null ? null : Number(p.last_credit)]));
  const rows = out.players.map((p) => {
    const before = prevMap.get(nameKey(p.name)) ?? null;
    return { ...p, prev_credit: before, changed: before !== null && before !== p.credit };
  });
  return { rows };
});
