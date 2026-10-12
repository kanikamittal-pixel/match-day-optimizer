import { emptyAgg, scoreAgg, type Agg, type ScoreRole } from '@/shared/scoring';
import { nameKey } from '@/shared/names';

/**
 * Turns one Cricsheet ball-by-ball match (JSON) into a Dream11 points row per player.
 * Data: https://cricsheet.org (ODC-BY licence: credit Cricsheet wherever this data is shown).
 * Super overs and no-result matches score nothing, as in Dream11.
 */
export interface PlayerRow {
  player: string;
  name_key: string;
  team: string;
  opponent: string;
  points: number;
  bat_pos: number | null;
  agg: Agg; // raw match aggregates (kept for tests; not stored)
}

export interface ParsedMatch {
  matchRef: string;
  playedOn: string; // YYYY-MM-DD
  matchType: string;
  gender: string;
  venue: string | null;
  event: string | null;
  rows: PlayerRow[];
}

export type Parsed = { skip: string } | ({ skip?: undefined } & ParsedMatch);

const WICKET_BOWLER = new Set(['bowled', 'lbw', 'caught', 'stumped', 'caught and bowled', 'hit wicket']);
const NOT_OUT = new Set(['retired hurt', 'retired not out']);

export function parseCricsheetMatch(json: any, matchRef: string): Parsed {
  const info = json?.info;
  if (!info?.teams || info.teams.length !== 2) return { skip: 'not a two-team match' };
  if (!/T20/i.test(String(info.match_type))) return { skip: `not T20 (${info.match_type})` };
  if (info.outcome?.result === 'no result' || info.outcome?.result === 'abandoned') return { skip: 'no result' };
  const innings = (json.innings ?? []).filter((i: any) => !i.super_over);
  if (!innings.length) return { skip: 'no innings' };

  const aggs = new Map<string, { agg: Agg; team: string; batPos: number | null; display: string }>();
  const slot = (team: string, player: string) => {
    const k = `${team}|${player}`;
    if (!aggs.has(k)) aggs.set(k, { agg: emptyAgg(), team, batPos: null, display: player });
    return aggs.get(k)!;
  };
  // everyone listed in the match squad "played" (+4); substitutes who took the field are listed too
  for (const t of info.teams as string[]) for (const p of info.players?.[t] ?? []) slot(t, p).agg.played = true;
  const teamOf = new Map<string, string>(); // player -> their team (to credit fielders / bowlers)
  for (const t of info.teams as string[]) for (const p of info.players?.[t] ?? []) teamOf.set(p, t);

  for (const inn of innings) {
    const batTeam: string = inn.team;
    const bowlTeam = (info.teams as string[]).find((t) => t !== batTeam)!;
    const order = new Map<string, number>();
    const overBowler = new Map<string, { legal: number; charged: number }>();
    for (const ov of inn.overs ?? []) {
      for (const d of ov.deliveries ?? []) {
        for (const who of [d.batter, d.non_striker]) if (who && !order.has(who)) order.set(who, order.size + 1);
        const wides = Number(d.extras?.wides ?? 0);
        const noballs = Number(d.extras?.noballs ?? 0);
        const byes = Number(d.extras?.byes ?? 0) + Number(d.extras?.legbyes ?? 0) + Number(d.extras?.penalty ?? 0);
        const legal = wides === 0 && noballs === 0;
        const bat = slot(batTeam, d.batter);
        const batterRuns = Number(d.runs?.batter ?? 0);
        bat.agg.played = true;
        bat.agg.runs += batterRuns;
        if (wides === 0) bat.agg.balls += 1;
        if (batterRuns === 6) bat.agg.sixes += 1;
        else if (batterRuns === 4 && !d.runs?.non_boundary) bat.agg.fours += 1;

        const bwl = slot(bowlTeam, d.bowler);
        bwl.agg.played = true;
        const charged = Number(d.runs?.total ?? 0) - byes;
        bwl.agg.runsConceded += charged;
        if (legal) {
          bwl.agg.ballsBowled += 1;
          if (charged === 0) bwl.agg.dots += 1;
        }
        const ok = `${ov.over}|${d.bowler}`;
        const o = overBowler.get(ok) ?? { legal: 0, charged: 0 };
        if (legal) o.legal += 1;
        o.charged += charged;
        overBowler.set(ok, o);

        for (const w of d.wickets ?? []) {
          const kind = String(w.kind);
          const out = slot(batTeam, w.player_out);
          if (!NOT_OUT.has(kind)) out.agg.out = true;
          if (WICKET_BOWLER.has(kind)) {
            bwl.agg.wickets += 1;
            if (kind === 'bowled' || kind === 'lbw') bwl.agg.lbwBowled += 1;
          }
          const fielders = (w.fielders ?? []).filter((f: any) => f.name && !f.substitute);
          if (kind === 'caught') for (const f of fielders.slice(0, 1)) slot(bowlTeam, f.name).agg.catches += 1;
          else if (kind === 'caught and bowled') bwl.agg.catches += 1;
          else if (kind === 'stumped') for (const f of fielders.slice(0, 1)) slot(bowlTeam, f.name).agg.stumpings += 1;
          else if (kind === 'run out') {
            if (fielders.length === 1) slot(bowlTeam, fielders[0].name).agg.runOutsDirect += 1;
            else for (const f of fielders.slice(-2)) slot(bowlTeam, f.name).agg.runOutsIndirect += 1;
          }
        }
      }
    }
    for (const [ok, o] of overBowler) {
      if (o.legal >= 6 && o.charged === 0) slot(bowlTeam, ok.split('|').slice(1).join('|')).agg.maidens += 1;
    }
    for (const [name, pos] of order) {
      const s = slot(batTeam, name);
      s.batPos = s.batPos === null ? pos : Math.min(s.batPos, pos);
    }
  }

  const rows: PlayerRow[] = [];
  for (const { agg, team, batPos, display } of aggs.values()) {
    if (!agg.played) continue;
    // Cricsheet has no roles: a player who bowls and bats at 8 or lower is treated as a bowler for the
    // duck / strike-rate exemptions. This is an approximation.
    const role: ScoreRole | undefined = agg.ballsBowled >= 12 && (batPos === null || batPos >= 8) ? 'BOWL' : undefined;
    rows.push({
      player: display,
      name_key: nameKey(display),
      team,
      opponent: (info.teams as string[]).find((t) => t !== team)!,
      points: Math.round(scoreAgg(agg, role) * 2) / 2,
      bat_pos: batPos,
      agg,
    });
  }
  return {
    matchRef,
    playedOn: String(info.dates?.[0] ?? ''),
    matchType: String(info.match_type),
    gender: String(info.gender ?? ''),
    venue: info.venue ?? null,
    event: info.event?.name ?? null,
    rows,
  };
}
