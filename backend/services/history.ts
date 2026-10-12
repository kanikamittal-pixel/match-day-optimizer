import type { SupabaseClient } from '@supabase/supabase-js';
import { blendBase, MIN_ALL, summariseForm, type FormRow, type PlayerHistory } from '@/shared/form';
import { dropSharedLinks, matchStrictAliases } from '@/shared/names';
import { loadAliases } from '@/backend/services/cricsheet-ingest';

const r1 = (n: number) => Math.round(n * 10) / 10;
const WINDOW_YEARS = 3;

async function pageAll<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[] | null> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) return null; // e.g. the table doesn't exist yet
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

/**
 * Fantasy history per player from `player_match_points` (Cricsheet). Players are matched to Cricsheet names inside
 * their own team's recent roster, strictly (surname + initial, one hit), so a wrong person is never used.
 * Only matches played BEFORE `cutoff` count, so predicting an old match can't see the future.
 * Falls back to this app's own saved results (recent form only) when Cricsheet has nothing for a player.
 */
export async function historyFor(
  sb: SupabaseClient,
  players: { key: string; name: string; team: string }[],
  cutoff: string,
  format: string,
  matchId?: string,
): Promise<Record<string, PlayerHistory>> {
  const out: Record<string, PlayerHistory> = {};
  const none = (note: string): PlayerHistory => ({ found: false, source: 'none', note });
  if (format !== 'T20') {
    for (const p of players) out[p.key] = none('Fantasy history is only available for T20 matches');
    return out;
  }
  const day = cutoff.slice(0, 10);
  const since = new Date(new Date(day).getTime() - WINDOW_YEARS * 365 * 86400000).toISOString().slice(0, 10);

  // 1. roster per team: who has played for this team lately
  const rosters = new Map<string, string[]>();
  let tableOk = true;
  for (const team of new Set(players.map((p) => p.team))) {
    const rows = await pageAll<{ player: string }>((a, b) => sb.from('player_match_points').select('player').ilike('team', team).gte('played_on', since).lt('played_on', day).range(a, b));
    if (rows === null) { tableOk = false; break; }
    rosters.set(team, [...new Set(rows.map((r) => r.player))]);
  }

  // 2. strict name link (surname + initial, also against the player's other known spellings)
  const link = new Map<string, string>(); // key -> cricsheet full name
  const aliases = tableOk ? await loadAliases(sb) : {};
  if (tableOk) for (const p of players) {
    const full = matchStrictAliases(p.name, rosters.get(p.team) ?? [], aliases);
    if (full) link.set(p.key, full);
  }

  const shared = dropSharedLinks(link);
  const clash = new Set(shared.dropped);
  link.clear();
  for (const [k, v] of shared.kept) link.set(k, v);

  // 3. their results before the cutoff
  const byName = new Map<string, { when: string; points: number }[]>();
  const names = [...new Set(link.values())];
  if (names.length) {
    for (let i = 0; i < names.length; i += 30) {
      const chunk = names.slice(i, i + 30);
      const rows = await pageAll<{ player: string; played_on: string; points: number }>((a, b) => sb.from('player_match_points').select('player,played_on,points').in('player', chunk).lt('played_on', day).order('played_on', { ascending: false }).range(a, b));
      for (const r of rows ?? []) byName.set(r.player, [...(byName.get(r.player) ?? []), { when: r.played_on, points: Number(r.points) }]);
    }
  }

  // 4. fallback: this app's own saved results
  const appRows: FormRow[] = [];
  const need = players.filter((p) => !link.has(p.key)).map((p) => p.key);
  if (need.length) {
    const acts = await sb.from('actual_points').select('match_id,name_key,points').in('name_key', need);
    const mids = [...new Set((acts.data ?? []).map((a: any) => a.match_id))].filter((m) => m !== matchId);
    if (mids.length) {
      const ms = await sb.from('matches').select('id,starts_at,created_at').in('id', mids);
      const when = new Map((ms.data ?? []).map((m: any) => [m.id, m.starts_at ?? m.created_at]));
      for (const a of acts.data ?? []) if (when.has(a.match_id)) appRows.push({ key: a.name_key, points: Number(a.points), when: when.get(a.match_id)! });
    }
  }
  const appForm = summariseForm(appRows);

  for (const p of players) {
    const full = link.get(p.key);
    const rows = full ? byName.get(full) ?? [] : [];
    if (full && rows.length) {
      const recent = rows.slice(0, 10).map((r) => r.points);
      const h: PlayerHistory = {
        found: true, source: 'cricsheet', cs_name: full,
        n_all: rows.length, mean_all: r1(rows.reduce((s, r) => s + r.points, 0) / rows.length),
        n_recent: recent.length, recent, mean_recent: r1(recent.reduce((s, x) => s + x, 0) / recent.length),
      };
      const b = blendBase(h);
      if (b) { h.base = b.base; h.basis = b.basis; }
      out[p.key] = h;
    } else if (appForm[p.key]?.n) {
      const f = appForm[p.key];
      const h: PlayerHistory = { found: true, source: 'app', n_recent: f.n, recent: f.points, mean_recent: f.avg, note: 'From your saved results only' };
      const b = blendBase(h);
      if (b) { h.base = b.base; h.basis = b.basis; }
      out[p.key] = h;
    } else {
      out[p.key] = none(!tableOk ? 'History table not set up yet' : clash.has(p.key) ? `“${p.name}” could be more than one player (two squad names match the same person), so no history is used` : full ? 'No earlier matches found for this player' : `Couldn’t match “${p.name}” to a recent ${p.team} player`);
    }
  }
  return out;
}

export { MIN_ALL };
