import { gemini, parseJson } from '@/backend/integrations/gemini';

export interface AnnouncedXI {
  announced: boolean;
  team_a_xi: string[];
  team_b_xi: string[];
  impact_subs: string[];
  note: string;
  sources: { title: string; uri: string }[];
}

/**
 * Asks Gemini + Google Search whether the playing XI has been officially announced.
 * No cricket API in the free tiers exposes the announced XI before the match starts, so this is the
 * only automatic route. It is never trusted blindly: the UI shows it as "verify" with source links.
 */
type MatchInfo = { team_a: string; team_b: string; venue: string | null; format: string | null; starts_at: string | null };

/**
 * One web search can miss an XI that is already out. From a few hours before the start, a "not announced" answer is
 * asked once more before it is believed.
 */
export async function lookupAnnouncedXI(m: MatchInfo): Promise<AnnouncedXI> {
  const first = await lookupOnce(m);
  const soon = m.starts_at ? Math.abs(new Date(m.starts_at).getTime() - Date.now()) < 6 * 3600e3 : false;
  if (first.announced || !soon) return first;
  const second = await lookupOnce(m);
  return second.announced ? second : first;
}

async function lookupOnce(m: MatchInfo): Promise<AnnouncedXI> {
  const { text, sources } = await gemini({
    grounding: true,
    prompt: `Use Google Search. Match: ${m.team_a} vs ${m.team_b}, ${m.format ?? 'T20'}, at ${m.venue ?? 'unknown venue'}, starting ${m.starts_at ?? 'soon'}.
Has the OFFICIAL playing XI for BOTH teams been announced (usually at the toss)? Only report an XI that has actually been announced. Do NOT give probable, predicted or squad lists.
Reply with ONLY a JSON object:
{"announced": boolean, "team_a_xi": [11 player names for ${m.team_a}], "team_b_xi": [11 player names for ${m.team_b}], "impact_subs": [names, may be empty], "note": "one short sentence on what you found"}
If the XI is not officially announced for both teams, set announced to false and leave the lists empty.`,
  });
  const j = parseJson<Partial<AnnouncedXI>>(text);
  const a = (j.team_a_xi ?? []).filter(Boolean);
  const b = (j.team_b_xi ?? []).filter(Boolean);
  const announced = !!j.announced && a.length === 11 && b.length === 11;
  return {
    announced,
    team_a_xi: announced ? a : [],
    team_b_xi: announced ? b : [],
    impact_subs: announced ? (j.impact_subs ?? []) : [],
    note: j.note ?? (announced ? 'Playing XI found.' : 'Team announcement not found.'),
    sources,
  };
}

export interface FoundSquad {
  announced: boolean; // true: official playing XI (after the toss); false: squad plus the XI most likely to play
  players: { name: string; team: 'A' | 'B'; role: 'WK' | 'BAT' | 'AR' | 'BOWL'; inXI: boolean }[];
  note: string;
  sources: { title: string; uri: string }[];
}

/** Squad of both teams (about 15 each) and the XI that is announced or most likely to play, from Google Search. */
export async function lookupSquad(m: { team_a: string; team_b: string; venue: string | null; format: string | null; starts_at: string | null }): Promise<FoundSquad> {
  const { text, sources } = await gemini({
    grounding: true,
    prompt: `Use Google Search. Match: ${m.team_a} vs ${m.team_b}, ${m.format ?? 'T20'}, at ${m.venue ?? 'unknown venue'}, starting ${m.starts_at ?? 'soon'}.
Find the squad of each team for THIS match (about 15 players each) and the playing XI. If the official XI is announced, use it and set "announced" true. Otherwise give the XI most likely to play, based on the last match and news, and set "announced" false.
Reply with ONLY a JSON object:
{"announced": boolean, "players": [{"name": full player name, "team": "A" for ${m.team_a} or "B" for ${m.team_b}, "role": one of "WK","BAT","AR","BOWL", "in_xi": boolean}], "note": "one short sentence on what you found"}
Mark exactly 11 players per team as in_xi. Only list real players for this match.`,
  });
  const j = parseJson<{ announced?: boolean; players?: any[]; note?: string }>(text);
  const roles = ['WK', 'BAT', 'AR', 'BOWL'];
  const players = (j.players ?? [])
    .filter((p) => p?.name && (p.team === 'A' || p.team === 'B'))
    .map((p) => ({ name: String(p.name).trim(), team: p.team as 'A' | 'B', role: (roles.includes(p.role) ? p.role : 'BAT') as 'WK' | 'BAT' | 'AR' | 'BOWL', inXI: !!p.in_xi }));
  return { announced: !!j.announced, players, note: j.note ?? '', sources };
}
