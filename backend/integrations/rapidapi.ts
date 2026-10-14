import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '@/backend/http';
import { pickKey } from '@/shared/budget';

/**
 * Second cricket data source: "Free Cricbuzz Cricket API" on RapidAPI.
 * The free plan allows only 100 requests per MONTH, so every call is cached in Supabase and counted
 * against a self-imposed monthly budget. Over budget (or on failure) we serve stale cache.
 * The key is sent in a header and only ever used server-side.
 */
const host = () => process.env.RAPIDAPI_CRICKET_HOST || 'free-cricbuzz-cricket-api.p.rapidapi.com';
const monthlyLimit = () => Number(process.env.RAPIDAPI_MONTHLY_LIMIT || 90);
const month = () => new Date().toISOString().slice(0, 7);
/** The keys in order of use: the main key, then an optional backup key from another account (RAPIDAPI_KEY_2). */
const keys = () => [process.env.RAPIDAPI_KEY, process.env.RAPIDAPI_KEY_2].filter((k): k is string => !!k);
const usageKey = (i = 0) => (i === 0 ? `rapid:usage:${month()}` : `rapid:usage${i}:${month()}`); // the main key keeps its original counter

export const RAPID_TTL = { schedule: 12 * 3600, live: 10 * 60 };

async function hitsFor(sb: SupabaseClient, i: number): Promise<number> {
  const { data } = await sb.from('api_cache').select('payload').eq('key', usageKey(i)).maybeSingle();
  return data?.payload?.hits ?? 0;
}
const saveHits = (sb: SupabaseClient, i: number, hits: number) => ({ key: usageKey(i), payload: { hits }, fetched_at: new Date().toISOString(), ttl_seconds: 31 * 86400 });

/** Calls used this month across all keys, against the combined budget. */
export async function rapidUsage(sb: SupabaseClient): Promise<{ hits: number; limit: number; keys: number }> {
  const n = Math.max(1, keys().length);
  const all = await Promise.all(Array.from({ length: n }, (_, i) => hitsFor(sb, i)));
  return { hits: all.reduce((a, b) => a + b, 0), limit: monthlyLimit() * n, keys: n };
}

export async function rapid<T = any>(sb: SupabaseClient, path: string, ttl: number, force = false): Promise<{ data: T; stale: boolean }> {
  const key = `rapid:${path}`;
  const { data: row } = await sb.from('api_cache').select('payload,fetched_at').eq('key', key).maybeSingle();
  const age = row ? (Date.now() - new Date(row.fetched_at).getTime()) / 1000 : Infinity;
  if (row && age < ttl && !force) return { data: row.payload as T, stale: false };

  const stale = (why: string) => {
    if (row) return { data: row.payload as T, stale: true };
    throw new HttpError(503, why, { manualFallback: true });
  };
  const list = keys();
  if (!list.length) return stale('RAPIDAPI_KEY is not set.');
  const used = await Promise.all(list.map((_, i) => hitsFor(sb, i)));

  for (let tries = 0; tries < list.length; tries++) {
    const i = pickKey(used, monthlyLimit(), true, 0); // no reserve here: fixtures are this key's only use
    if (i < 0) return stale(`RapidAPI monthly budget used (${used.join('/')} of ${monthlyLimit()} per key).`);
    let res: Response;
    try {
      res = await fetch(`https://${host()}/${path}`, { headers: { 'x-rapidapi-key': list[i], 'x-rapidapi-host': host() }, cache: 'no-store' });
    } catch {
      return stale('RapidAPI is unreachable.');
    }
    // RapidAPI reports the real allowance in headers: trust it over our own count
    const lim = Number(res.headers.get('x-ratelimit-requests-limit')), rem = Number(res.headers.get('x-ratelimit-requests-remaining'));
    used[i] = Number.isFinite(lim) && Number.isFinite(rem) && res.headers.get('x-ratelimit-requests-remaining') !== null ? Math.max(used[i] + 1, lim - rem) : used[i] + 1;
    if (res.status === 429 || res.status === 403) { used[i] = monthlyLimit(); await sb.from('api_cache').upsert(saveHits(sb, i, used[i])); continue; } // this key is used up: try the next one
    if (!res.ok) return stale(`RapidAPI ${res.status}`);
    const json = await res.json();
    await sb.from('api_cache').upsert([{ key, payload: json, fetched_at: new Date().toISOString(), ttl_seconds: ttl }, saveHits(sb, i, used[i])]);
    return { data: json as T, stale: false };
  }
  return stale('RapidAPI: every key is used up for this month.');
}

export interface RapidMatch {
  id: string;
  name: string;
  team_a: string;
  team_b: string;
  venue: string | null;
  format: 'T20' | 'ODI' | 'TEST';
  starts_at: string;
  status: string;
}

/** Normalise the schedule feed. Phase is derived from the schedule's own start/end times. */
export function parseSchedule(json: any, now = Date.now()): RapidMatch[] {
  const out = new Map<string, RapidMatch>(); // multi-day matches repeat on every day of the schedule
  for (const day of json?.response?.schedules ?? []) {
    for (const series of day.scheduleAdWrapper?.matchScheduleList ?? []) {
      for (const m of series.matchInfo ?? []) {
        const start = Number(m.startDate);
        const end = Number(m.endDate);
        if (!start || !m.team1?.teamName || !m.team2?.teamName) continue;
        const f = String(m.matchFormat ?? '').toUpperCase();
        const format = f.includes('ODI') ? 'ODI' : f.includes('TEST') ? 'TEST' : 'T20';
        // short formats are over a few hours after the start; multi-day matches use the schedule's end date
        const over = format === 'TEST' ? now > end : now > start + (format === 'T20' ? 5 : 10) * 3600 * 1000;
        const status = over ? 'Completed' : now >= start ? 'In progress' : 'Scheduled';
        out.set(`rb-${m.matchId}`, {
          id: `rb-${m.matchId}`,
          name: `${m.team1.teamName} vs ${m.team2.teamName}, ${m.matchDesc ?? ''} · ${series.seriesName ?? ''}`.trim(),
          team_a: m.team1.teamName,
          team_b: m.team2.teamName,
          venue: [m.venueInfo?.ground, m.venueInfo?.city].filter(Boolean).join(', ') || null,
          format,
          starts_at: new Date(start).toISOString(),
          status,
        });
      }
    }
  }
  return [...out.values()];
}
