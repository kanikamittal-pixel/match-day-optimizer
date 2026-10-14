/**
 * API budget with a reserve. Routine calls (fixture refreshes, squads) stop RESERVE hits before the daily limit, so the
 * calls that matter (scorecards for results and for the history top-up) can always run.
 */
export const RESERVE = 15;

export function callAllowed(hits: number, limit: number, essential: boolean, reserve = RESERVE): boolean {
  return essential ? hits < limit : hits < limit - reserve;
}

/**
 * With more than one key for the same service, use the first key that still has budget (index into `hits`), or -1 if
 * none does. Routine calls leave each key's reserve alone and move on to the next key; essential calls may use it.
 */
export function pickKey(hits: number[], limit: number, essential: boolean, reserve = RESERVE): number {
  return hits.findIndex((h) => callAllowed(h, limit, essential, reserve));
}
