import { handle, HttpError } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import type { FinalTeam, Recommended } from '@/shared/types';

/** The post-match list: final XI plus any recommended player Aryan dropped, so both judgements are scored. */
export const GET = handle(async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const { data: dec } = await sb.from('team_decisions').select('recommended,final,status').eq('match_id', id).maybeSingle();
  if (!dec) throw new HttpError(404, 'No team was built for this match.');
  const rec = dec.recommended as Recommended;
  const fin = dec.final as FinalTeam;
  const keys = [...new Set([...fin.xi, ...rec.xi])];
  const preds = must(await sb.from('predictions').select('name_key,player_name,team,role,expected_points').in('name_key', keys).eq('match_id', id), 'preds') as any[];
  const acts = must(await sb.from('actual_points').select('name_key,points').eq('match_id', id), 'acts') as any[];
  const have = new Map(acts.map((a) => [a.name_key, Number(a.points)]));
  const players = preds.map((p) => ({
    key: p.name_key,
    name: p.player_name,
    team: p.team,
    role: p.role,
    xp: Number(p.expected_points),
    in_final: fin.xi.includes(p.name_key),
    dropped: !fin.xi.includes(p.name_key),
    points: have.get(p.name_key) ?? null,
  }));
  return { players: players.sort((a, b) => Number(b.in_final) - Number(a.in_final) || b.xp - a.xp), captain: fin.captain, vc: fin.vc, agentCaptain: rec.captain, agentVc: rec.vc, status: dec.status };
});

export const PUT = handle(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const { sb } = await requireUser();
  const { points } = (await req.json()) as { points: { key: string; points: number | null }[] };
  const { data: dec } = await sb.from('team_decisions').select('recommended,final').eq('match_id', id).maybeSingle();
  if (!dec) throw new HttpError(404, 'No team was built for this match.');
  const fin = dec.final as FinalTeam;
  const rec = dec.recommended as Recommended;
  const preds = must(await sb.from('predictions').select('name_key,player_name').eq('match_id', id), 'preds') as any[];
  const names = new Map(preds.map((p) => [p.name_key, p.player_name]));
  const rows = points
    .filter((p) => p.points !== null && p.points !== undefined && Number.isFinite(Number(p.points)) && names.has(p.key))
    .map((p) => ({ match_id: id, name_key: p.key, player_name: names.get(p.key), points: Number(p.points), in_final_xi: fin.xi.includes(p.key), in_recommended_xi: rec.xi.includes(p.key) }));
  if (!rows.length) throw new HttpError(400, 'Enter points for at least one player.');
  must(await sb.from('actual_points').upsert(rows), 'save actuals');
  return { saved: rows.length };
});
