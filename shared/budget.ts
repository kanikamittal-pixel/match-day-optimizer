/**
 * API budget with a reserve. Routine calls (fixture refreshes, squads) stop RESERVE hits before the daily limit, so the
 * calls that matter (scorecards for results and for the history top-up) can always run.
 */
export const RESERVE = 15;

export function callAllowed(hits: number, limit: number, essential: boolean, reserve = RESERVE): boolean {
  return essential ? hits < limit : hits < limit - reserve;
}
