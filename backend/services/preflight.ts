import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '@/backend/http';
import { eligibleKeys, loadCredits, loadMatch, loadRules, toCandidates } from '@/backend/db/queries';
import type { Stage } from '@/shared/types';

export interface Gap {
  code: 'xi' | 'credits';
  message: string;
}

/**
 * The "stop and ask" gate. If credits or the XI are missing the app refuses to produce a team
 * (HTTP 422 with the exact gaps) instead of guessing. Pre-toss runs are allowed on a probable XI
 * but are labelled as such everywhere.
 */
export async function preflight(sb: SupabaseClient, matchId: string) {
  const [match, rules, credits] = await Promise.all([loadMatch(sb, matchId), loadRules(sb), loadCredits(sb, matchId)]);
  const gaps: Gap[] = [];
  if (!credits.length) gaps.push({ code: 'credits', message: 'Confirm the credit table first (upload a Dream11 screenshot or type it in).' });
  const keys = eligibleKeys(match.xi);
  if (keys.length < rules.team_size) gaps.push({ code: 'xi', message: 'Set the playing XI (or the probable XI for a pre-toss run).' });
  const { pool, missing } = toCandidates(credits, keys);
  if (missing.length) {
    gaps.push({ code: 'credits', message: `No credit value for ${missing.length} XI player(s): ${missing.slice(0, 5).join(', ')}. Add them to the credit table.` });
  }
  if (gaps.length) throw new HttpError(422, gaps[0].message, { gaps });
  const stage: Stage = match.xi?.confirmed ? 'final' : 'pre_toss';
  return { match, rules, credits, pool, stage };
}

export const stageLabel = (s: Stage) => (s === 'pre_toss' ? 'PRE-TOSS RUN: based on a PROBABLE XI, not confirmed.' : 'FINAL RUN: confirmed playing XI.');
