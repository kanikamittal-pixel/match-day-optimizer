import { teamLookup } from '@/shared/names';

export interface PlayedPlayer { name: string; team: string; points: number; batPos: number | null }

/**
 * Who actually played in a match and what they scored, with no input from anyone: the result already saved for the
 * match if there is one, otherwise the Cricsheet ball-by-ball record found by teams and date.
 */
export async function playedPlayers(sb: any, matchId: string, m: { team_a: string; team_b: string; starts_at: string | null }): Promise<{ players: PlayedPlayer[]; source: string } | { note: string }> {
  const { data: act } = await sb.from('actual_points').select('player_name,points').eq('match_id', matchId);
  if (act?.length) return { players: act.map((a: any) => ({ name: a.player_name, team: '', points: Number(a.points), batPos: null })), source: 'Result entered or fetched for this match' };
  if (!m.starts_at) return { note: 'This match has no start time, so the record cannot be found.' };
  const t = new Date(m.starts_at).getTime();
  if (t > Date.now()) return { note: 'The match has not been played yet. When it has, the report fills in on its own.' };
  const from = new Date(t - 36 * 3600e3).toISOString().slice(0, 10), to = new Date(t + 36 * 3600e3).toISOString().slice(0, 10);
  const na = teamLookup(m.team_a).names, nb = teamLookup(m.team_b).names;
  const { data: pmp } = await sb.from('player_match_points').select('match_ref,team,player,points,bat_pos').in('team', [...na, ...nb]).gte('played_on', from).lte('played_on', to);
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
  const is = (names: string[], team: string) => names.some((n) => norm(n) === norm(team));
  const rows = (pmp ?? []) as any[];
  const refs = [...new Set(rows.map((r) => r.match_ref))];
  const ref = refs.find((x) => { const rs = rows.filter((r) => r.match_ref === x); return rs.some((r) => is(na, r.team)) && rs.some((r) => is(nb, r.team)) && rs.length >= 20; });
  if (!ref) return { note: 'The match has been played, but the ball-by-ball record is not published yet (it arrives a few days after the match). The report appears here on its own.' };
  return { players: rows.filter((r) => r.match_ref === ref).map((r) => ({ name: r.player, team: r.team, points: Number(r.points), batPos: r.bat_pos ?? null })), source: 'Cricsheet ball-by-ball record of the match' };
}
