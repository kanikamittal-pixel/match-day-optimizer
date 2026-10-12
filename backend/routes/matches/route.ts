import { handle, HttpError } from '@/backend/http';
import { must, requireUser } from '@/backend/integrations/supabase';
import { cricket, formatOf, TTL } from '@/backend/integrations/cricketdata';
import { rapid, parseSchedule, RAPID_TTL } from '@/backend/integrations/rapidapi';
import { ensureSeed } from '@/backend/db/queries';


/** Pull fixtures from both cricket APIs into the matches table (cached by each integration). Slow: used in the background. */
async function syncFromApis(sb: any, force: boolean): Promise<string | null> {
  const notes: string[] = [];
  const cdPromise = (async () => {
    try {
      const { data, stale } = await cricket<any>(sb, 'currentMatches', { offset: '0' }, TTL.matches, force);
      if (stale) notes.push('Showing cached fixtures (CricketData unavailable or over budget).');
      const rows = (data.data ?? [])
        .filter((m: any) => Array.isArray(m.teams) && m.teams.length === 2)
        .map((m: any) => ({
          id: m.id, name: m.name, team_a: m.teams[0], team_b: m.teams[1], venue: m.venue ?? null, format: formatOf(m.matchType),
          starts_at: m.dateTimeGMT ? new Date(m.dateTimeGMT.endsWith('Z') ? m.dateTimeGMT : `${m.dateTimeGMT}Z`).toISOString() : null,
          status: m.status ?? null,
        }));
      if (rows.length) must(await sb.from('matches').upsert(rows, { onConflict: 'id' }), 'save matches');
    } catch (e) {
      notes.push(e instanceof HttpError ? e.message : 'Could not reach CricketData.');
    }
  })();
  const rapidPromise = (async () => {
    try {
      const { data: cd } = await sb.from('matches').select('team_a,team_b,starts_at').not('id', 'like', 'rb-%');
      const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '');
      const seen = new Set((cd ?? []).map((m: any) => `${norm(m.team_a)}|${norm(m.team_b)}|${String(m.starts_at).slice(0, 10)}`));
      const { data: sched, stale } = await rapid<any>(sb, 'cricket-schedule', RAPID_TTL.schedule, force);
      if (stale) notes.push('Showing cached RapidAPI schedule.');
      const horizon = Date.now() + 3 * 24 * 3600 * 1000;
      const rows = parseSchedule(sched)
        .filter((m) => new Date(m.starts_at).getTime() < horizon)
        .filter((m) => !seen.has(`${norm(m.team_a)}|${norm(m.team_b)}|${m.starts_at.slice(0, 10)}`));
      if (rows.length) must(await sb.from('matches').upsert(rows, { onConflict: 'id' }), 'save rapid matches');
    } catch (e) {
      notes.push(e instanceof HttpError ? e.message : 'RapidAPI unavailable.');
    }
  })();
  await Promise.all([cdPromise, rapidPromise]);
  return notes.join(' ') || null;
}

/**
 * Home data. FAST by default: it only reads the database (three queries in parallel). The page then calls it again
 * with ?sync=1 in the background to pull fresh fixtures from the cricket APIs, so nobody waits on those.
 */
export const GET = handle(async (req: Request) => {
  const { sb } = await requireUser();
  await ensureSeed(sb);
  const q = new URL(req.url).searchParams;
  const force = q.get('refresh') === '1';
  let apiNote: string | null = null;
  if (q.get('sync') === '1' || force) apiNote = await syncFromApis(sb, force);

  const since = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const [matchesRes, decRes, actRes] = await Promise.all([
    sb.from('matches').select('id,name,team_a,team_b,venue,format,starts_at,status,contest_type,xi').or(`starts_at.gte.${since},starts_at.is.null`).order('starts_at', { ascending: true, nullsFirst: false }).limit(60),
    sb.from('team_decisions').select('match_id,status,stage'),
    sb.from('actual_points').select('match_id'),
  ]);
  const matches = must(matchesRes, 'list matches');
  const decisions = must(decRes, 'decisions') as any[];
  const acts = must(actRes, 'actuals') as any[];
  const hasActuals = new Set(acts.map((a) => a.match_id));
  const dec = new Map(decisions.map((d) => [d.match_id, d]));
  const awaitingIds = decisions.filter((d) => d.status === 'final' && !hasActuals.has(d.match_id)).map((d) => d.match_id);
  const awaiting = awaitingIds.length ? must(await sb.from('matches').select('id,name,starts_at').in('id', awaitingIds), 'awaiting') : [];

  // Phase comes from the API status text plus the start time, so finished matches never read "Not started".
  const DONE = /\b(won by|won the match|match drawn|drawn|tied|no result|abandoned|match ended|completed|result)\b/i;
  const phaseOf = (m: any): 'completed' | 'live' | 'upcoming' => {
    if (m.status && DONE.test(m.status)) return 'completed';
    if (m.starts_at && new Date(m.starts_at).getTime() <= Date.now()) return 'live';
    return 'upcoming';
  };
  const withPhase = (matches as any[]).map((m) => ({ ...m, phase: phaseOf(m), has_team: dec.has(m.id), team_status: dec.get(m.id)?.status ?? null, results_in: hasActuals.has(m.id) }));
  // Hide finished matches Aryan never worked on; keep ones with a team so results can still be entered.
  // Test / first-class matches are left out: our scoring and fantasy history are T20-only (kept only if a team already exists)
  const visible = withPhase
    .filter((m) => m.format !== 'TEST' || m.has_team)
    .filter((m) => m.phase !== 'completed' || m.has_team)
    .sort((a, b) => Number(a.format === 'TEST') - Number(b.format === 'TEST') || String(a.starts_at).localeCompare(String(b.starts_at)));

  return {
    matches: visible,
    awaiting,
    apiNote,
  };
});

/** Manual match (fallback when the API has not listed it). */
export const POST = handle(async (req: Request) => {
  const { sb } = await requireUser();
  const b = await req.json();
  if (!b.team_a || !b.team_b) throw new HttpError(400, 'Both teams are required.');
  const id = `manual-${crypto.randomUUID()}`;
  must(await sb.from('matches').insert({ id, name: `${b.team_a} vs ${b.team_b}`, team_a: b.team_a, team_b: b.team_b, venue: b.venue || null, format: b.format || 'T20', starts_at: b.starts_at || null }), 'create match');
  return { id };
});
