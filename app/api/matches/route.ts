import { handle, HttpError } from '@/server/http';
import { must, requireUser } from '@/server/integrations/supabase';
import { cricket, formatOf, TTL, usageToday } from '@/server/integrations/cricketdata';
import { ensureSeed } from '@/server/db/queries';

export const maxDuration = 30;

/** Home data: upcoming/today matches (API, cached), matches awaiting results, API budget. */
export const GET = handle(async (req: Request) => {
  const { sb } = await requireUser();
  await ensureSeed(sb);
  const force = new URL(req.url).searchParams.get('refresh') === '1';
  let apiNote: string | null = null;
  try {
    const { data, stale } = await cricket<any>(sb, 'currentMatches', { offset: '0' }, TTL.matches, force);
    if (stale) apiNote = 'Showing cached fixtures (CricketData unavailable or over budget).';
    const rows = (data.data ?? [])
      .filter((m: any) => Array.isArray(m.teams) && m.teams.length === 2)
      .map((m: any) => ({
        id: m.id,
        name: m.name,
        team_a: m.teams[0],
        team_b: m.teams[1],
        venue: m.venue ?? null,
        format: formatOf(m.matchType),
        starts_at: m.dateTimeGMT ? new Date(m.dateTimeGMT.endsWith('Z') ? m.dateTimeGMT : `${m.dateTimeGMT}Z`).toISOString() : null,
        status: m.status ?? null,
      }));
    if (rows.length) must(await sb.from('matches').upsert(rows, { onConflict: 'id' }), 'save matches');
  } catch (e) {
    apiNote = e instanceof HttpError ? e.message : 'Could not reach CricketData.';
  }

  const since = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
  const matches = must(
    await sb.from('matches').select('id,name,team_a,team_b,venue,format,starts_at,status,contest_type,xi').or(`starts_at.gte.${since},starts_at.is.null`).order('starts_at', { ascending: true, nullsFirst: false }).limit(60),
    'list matches',
  );
  const decisions = must(await sb.from('team_decisions').select('match_id,status,stage'), 'decisions') as any[];
  const acts = must(await sb.from('actual_points').select('match_id'), 'actuals') as any[];
  const hasActuals = new Set(acts.map((a) => a.match_id));
  const dec = new Map(decisions.map((d) => [d.match_id, d]));
  const awaitingIds = decisions.filter((d) => d.status === 'final' && !hasActuals.has(d.match_id)).map((d) => d.match_id);
  const awaiting = awaitingIds.length ? must(await sb.from('matches').select('id,name,starts_at').in('id', awaitingIds), 'awaiting') : [];

  return {
    matches: (matches as any[]).map((m) => ({ ...m, has_team: dec.has(m.id), team_status: dec.get(m.id)?.status ?? null, results_in: hasActuals.has(m.id) })),
    awaiting,
    usage: await usageToday(sb),
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
