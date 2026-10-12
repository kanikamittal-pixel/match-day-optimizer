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
export async function lookupAnnouncedXI(m: { team_a: string; team_b: string; venue: string | null; format: string | null; starts_at: string | null }): Promise<AnnouncedXI> {
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
