import type { SupabaseClient } from '@supabase/supabase-js';
import { gemini, parseJson, S } from '@/backend/integrations/gemini';
import { findGeneric } from '@/shared/reasons';
import { HttpError } from '@/backend/http';
import type { Candidate, ContestType, PitchType } from '@/shared/types';
import { loadPlaybook } from '@/backend/db/queries';
import type { PlayerHistory } from '@/shared/form';
import { situationKey } from '@/backend/db/queries';

const PITCH: PitchType[] = ['batting_friendly', 'pace_friendly', 'spin_friendly', 'slow_low', 'balanced'];

export interface Conditions {
  pitch_report: string;
  surface: string;
  pitch_type: PitchType;
  weather: string;
  dew: string;
  team_news: string;
  venue_stats: string;
  sources: { title: string; uri: string }[];
}

/** Gemini Flash + Grounding with Google Search: pitch, surface, weather/dew, late news, venue record. */
export async function fetchConditions(m: { team_a: string; team_b: string; venue: string | null; format: string | null; starts_at: string | null }): Promise<Conditions> {
  const { text, sources } = await gemini({
    grounding: true,
    prompt: `Use Google Search. Match: ${m.team_a} vs ${m.team_b}, ${m.format ?? 'T20'}, at ${m.venue ?? 'unknown venue'}, on ${m.starts_at ?? 'an upcoming date'}.
Find the pitch report, soil/surface type, weather and dew forecast, late team news (injuries, rested players, confirmed changes) and the venue's record (average first-innings score, chase vs defend results, pace vs spin wicket share).
Reply with ONLY a JSON object, no prose, with exactly these keys:
{"pitch_report": string, "surface": string, "pitch_type": one of ${JSON.stringify(PITCH)}, "weather": string, "dew": string, "team_news": string, "venue_stats": string}
Be concise (max 40 words per field). If something is not findable, say "not found" for that field rather than guessing.`,
  });
  const j = parseJson<Omit<Conditions, 'sources'>>(text);
  return {
    pitch_report: j.pitch_report ?? 'not found',
    surface: j.surface ?? 'not found',
    pitch_type: PITCH.includes(j.pitch_type) ? j.pitch_type : 'balanced',
    weather: j.weather ?? 'not found',
    dew: j.dew ?? 'not found',
    team_news: j.team_news ?? 'not found',
    venue_stats: j.venue_stats ?? 'not found',
    sources,
  };
}

/** Plain-language summary of where the model has historically missed, from stored errors (n >= 8 only). */
export async function errorPatternsFor(sb: SupabaseClient, venue: string | null, pitch: string | null): Promise<string> {
  const { data: preds } = await sb.from('predictions').select('match_id,name_key,role,batting_position,expected_points');
  const { data: acts } = await sb.from('actual_points').select('match_id,name_key,points');
  const { data: matches } = await sb.from('matches').select('id,venue,format,context');
  if (!preds?.length || !acts?.length || !matches?.length) return 'No history yet.';
  const actual = new Map(acts.map((a) => [`${a.match_id}|${a.name_key}`, Number(a.points)]));
  const mm = new Map(matches.map((m) => [m.id, m]));
  const groups = new Map<string, number[]>();
  const push = (k: string, v: number) => groups.set(k, [...(groups.get(k) ?? []), v]);
  for (const p of preds) {
    const a = actual.get(`${p.match_id}|${p.name_key}`);
    if (a === undefined) continue;
    const m = mm.get(p.match_id);
    const err = Number(p.expected_points) - a;
    if (m?.venue && m.venue === venue) push(`at ${venue}, role ${p.role}`, err);
    const pt = m?.context?.pitch_type;
    if (pt && pt === pitch) push(`on ${pt.replace(/_/g, ' ')} pitches, role ${p.role}`, err);
  }
  const lines = [...groups]
    .filter(([, v]) => v.length >= 8)
    .map(([k, v]) => ({ k, n: v.length, bias: v.reduce((s, x) => s + x, 0) / v.length }))
    .filter((x) => Math.abs(x.bias) >= 3)
    .map((x) => `${x.k}: past predictions ran ${x.bias > 0 ? 'HIGH' : 'LOW'} by ${Math.abs(x.bias).toFixed(1)} pts per player (n=${x.n})`);
  return lines.length ? lines.join('\n') : 'No repeated misses with 8+ data points yet.';
}

export interface PredictionRow {
  key: string;
  name: string;
  batting_position: number | null;
  expected_points: number;
  reason: string;
  /** Code-computed base (50% overall + 50% recent fantasy average), null when no history was found */
  base: number | null;
  adjustment: number | null;
  basis: string | null;
}

/** Gemini may only nudge the code-computed base for conditions, never replace it. */
export const maxAdjustment = (base: number) => Math.max(10, 0.4 * base);

function historyText(h?: PlayerHistory): string {
  if (!h || h.base === undefined) return `NO RELIABLE HISTORY (${h?.note ?? 'none found'}): give your own expected_points; leave adjustment null`;
  const bits: string[] = [];
  if (h.n_all) bits.push(`overall T20 fantasy avg ${h.mean_all} over ${h.n_all} matches`);
  if (h.n_recent) bits.push(`last ${h.n_recent} matches: ${h.recent!.join(', ')} (avg ${h.mean_recent})`);
  return `BASE ${h.base} [${h.basis}; ${bits.join('; ')}]: do NOT change it; return only an adjustment, leave expected_points null`;
}

export async function predictExpectedPoints(
  sb: SupabaseClient,
  args: {
    match: { team_a: string; team_b: string; venue: string | null; format: string | null; contest_type: ContestType; context: any };
    pool: Candidate[];
    weights: Record<string, number>;
    weightsVersion: number;
    stageLabel: string;
    history?: Record<string, PlayerHistory>;
  },
): Promise<PredictionRow[]> {
  const { match, pool, weights, history = {} } = args;
  const playbook = await loadPlaybook(sb);
  const patterns = await errorPatternsFor(sb, match.venue, match.context?.pitch_type ?? null);
  const ctx = match.context ?? {};
  const roster = pool.map((p) => `${p.name} | ${p.team} | ${p.role} | ${p.credit > 0 ? `${p.credit}cr` : 'credit n/a'} | ${historyText(history[p.key])}`).join('\n');
  const nullableNum = { type: 'NUMBER', nullable: true };
  const schema = S.obj({
    players: S.arr(S.obj({ name: S.str, batting_position: S.int, adjustment: nullableNum, expected_points: nullableNum, reason: S.str })),
  });

  const base = `MATCH: ${match.team_a} vs ${match.team_b}, ${match.format ?? 'T20'}, venue ${match.venue ?? 'unknown'}. ${args.stageLabel}
CONDITIONS (from live search): pitch ${ctx.pitch_report ?? 'unknown'}; surface ${ctx.surface ?? 'unknown'}; type ${ctx.pitch_type ?? 'unknown'}; weather ${ctx.weather ?? 'unknown'}; dew ${ctx.dew ?? 'unknown'}; venue record ${ctx.venue_stats ?? 'unknown'}; team news ${ctx.team_news ?? 'unknown'}.
APPROVED SCORING WEIGHTS v${args.weightsVersion} (points per event; adj_* are situational multipliers, 1 = neutral): ${JSON.stringify(weights)}
ARYAN'S PLAYBOOK RULES (apply them; where owner is aryan his judgement overrides yours): ${playbook.length ? playbook.map((r) => `[${r.owner}] ${r.situation}: ${r.rule}`).join(' | ') : 'none'}
PAST PREDICTION-ERROR PATTERNS (correct for these): ${patterns}
PLAYERS (name | team | Dream11 role | credits | history):
${roster}

How the numbers work. For a player with a BASE, the base is already the code-computed expectation (equal 50/50 weight of the player's overall and recent Dream11 fantasy average). You must NOT recompute or replace it. Return only "adjustment": points to add or subtract for THIS match (venue and pitch fit, weather and dew, opposition, expected batting position, role in this XI, team news). It can be negative, and should stay within about +/-40% of the base. Set expected_points to null.
For a player with NO RELIABLE HISTORY, return your own "expected_points" (one decimal) and set adjustment to null.
For EVERY player return: name (exactly as given), batting_position (1-11 expected batting slot, 0 if unlikely to bat), adjustment, expected_points, reason.
REASON RULES: one sentence, max 25 words, must cite something specific to THIS match: venue record, record vs this opposition, the pitch, batting position or conditions (e.g. "Opens on a slow surface here where first-innings par is 158"). Only mention form or averages that appear in the history column. Never write generic reasons like "in good form", "key player", "consistent performer", "reliable option".`;

  let feedback = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    const { text } = await gemini({
      system: 'You are a sharp fantasy cricket analyst. Respond with strict JSON only.',
      prompt: base + feedback,
      schema,
      temperature: 0.3,
    });
    const out = parseJson<{ players: { name: string; batting_position: number; adjustment: number | null; expected_points: number | null; reason: string }[] }>(text);
    const byName = new Map(out.players.map((p) => [p.name.toLowerCase().trim(), p]));
    const rows: PredictionRow[] = [];
    const missing: string[] = [];
    for (const c of pool) {
      const p = byName.get(c.name.toLowerCase().trim());
      const h = history[c.key];
      const hasBase = h?.base !== undefined;
      const adj = p?.adjustment;
      const own = p?.expected_points;
      if (!p || (hasBase ? typeof adj !== 'number' || !Number.isFinite(adj) : typeof own !== 'number' || !Number.isFinite(own))) {
        missing.push(c.name);
        continue;
      }
      let xp: number;
      let adjUsed: number | null = null;
      if (hasBase) {
        const cap = maxAdjustment(h.base!);
        adjUsed = Math.round(Math.max(-cap, Math.min(cap, adj as number)) * 10) / 10;
        xp = Math.max(0, Math.round((h.base! + adjUsed) * 10) / 10);
      } else {
        xp = Math.max(0, Math.round((own as number) * 10) / 10);
      }
      rows.push({ key: c.key, name: c.name, batting_position: p.batting_position > 0 ? p.batting_position : null, expected_points: xp, reason: p.reason.trim(), base: hasBase ? h.base! : null, adjustment: adjUsed, basis: hasBase ? h.basis ?? null : null });
    }
    const generic = findGeneric(rows.map((r) => ({ name: r.name, reason: r.reason })), { venue: match.venue, teams: [match.team_a, match.team_b] });
    if (!missing.length && !generic.length) return rows;
    console.warn(`[predict] attempt ${attempt + 1} rejected. missing=${JSON.stringify(missing)} generic=${JSON.stringify(rows.filter((r) => generic.includes(r.name)).map((r) => `${r.name}: ${r.reason}`).slice(0, 4))}`);
    feedback = `\n\nYOUR PREVIOUS ANSWER WAS REJECTED. ${missing.length ? `Missing or wrong fields for: ${missing.join(', ')} (players with a BASE need a numeric adjustment; players without need a numeric expected_points). ` : ''}${generic.length ? `Generic or non-specific reasons for: ${generic.join(', ')}. Rewrite them citing venue, opposition, pitch, batting position or conditions.` : ''} Return ALL players again.`;
  }
  throw new HttpError(502, 'Gemini kept returning generic or incomplete predictions. Try again in a moment.');
}

export interface CVC {
  captain: string;
  vc: string;
  reason: string;
  bench: { key: string; reason: string }[];
  source: 'gemini' | 'fallback';
}

export async function pickCaptains(args: {
  match: { team_a: string; team_b: string; venue: string | null; format: string | null; contest_type: ContestType; context: any };
  xi: Candidate[];
  bench: Candidate[];
  reasons: Map<string, string>;
}): Promise<CVC> {
  const { match, xi, bench, reasons } = args;
  const line = (p: Candidate) => `${p.name} | ${p.team} | ${p.role} | xP ${p.xp} | ${reasons.get(p.key) ?? ''}`;
  const schema = S.obj({
    captain: S.str,
    vice_captain: S.str,
    reason: S.str,
    bench_calls: S.arr(S.obj({ name: S.str, reason: S.str })),
  });
  const prompt = `MATCH: ${match.team_a} vs ${match.team_b} at ${match.venue ?? 'unknown'}, ${match.format ?? 'T20'}. Contest: ${match.contest_type === 'small' ? 'SMALL league, prefer the safe, high-floor captain' : 'GRAND league, a differential captain is acceptable if the upside is real'}.
Pitch: ${match.context?.pitch_report ?? 'unknown'}.
VALIDATED XI (name | team | role | expected points | reason):
${xi.map(line).join('\n')}
NOTABLE BENCH (not selected):
${bench.slice(0, 8).map(line).join('\n')}

Choose the CAPTAIN (2x) and VICE-CAPTAIN (1.5x) from the XI above only, two different players. Give a reason of AT MOST TWO sentences that Aryan could confidently say out loud to his fantasy league group, specific to this match and venue.
Also give one-line reasons for up to 4 notable players left on the bench (why they missed out). Use names exactly as given.`;
  const byName = new Map(xi.map((p) => [p.name.toLowerCase().trim(), p]));
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { text } = await gemini({ system: 'Respond with strict JSON only.', prompt, schema, temperature: 0.3 });
      const j = parseJson<{ captain: string; vice_captain: string; reason: string; bench_calls: { name: string; reason: string }[] }>(text);
      const c = byName.get(j.captain?.toLowerCase().trim());
      const v = byName.get(j.vice_captain?.toLowerCase().trim());
      if (c && v && c.key !== v.key && j.reason) {
        const benchByName = new Map(bench.map((p) => [p.name.toLowerCase().trim(), p]));
        const benchCalls = (j.bench_calls ?? [])
          .map((b) => ({ p: benchByName.get(b.name.toLowerCase().trim()), reason: b.reason }))
          .filter((b) => b.p)
          .map((b) => ({ key: b.p!.key, reason: b.reason }));
        return { captain: c.key, vc: v.key, reason: j.reason, bench: benchCalls, source: 'gemini' };
      }
    } catch (e) {
      if (attempt === 1) console.error('C/VC Gemini failed', e);
    }
  }
  const top = [...xi].sort((a, b) => b.xp - a.xp);
  return {
    captain: top[0].key,
    vc: top[1].key,
    reason: `Fallback: the two highest expected scorers (${top[0].xp} and ${top[1].xp} xP). The AI captain pick could not be validated.`,
    bench: [],
    source: 'fallback',
  };
}

export { situationKey };
