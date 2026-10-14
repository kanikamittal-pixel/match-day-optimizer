import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '@/backend/http';
import { pickKey } from '@/shared/budget';

const BASE = 'https://api.cricapi.com/v1';
const limit = () => Number(process.env.CRICKETDATA_DAILY_LIMIT || 95);

export const TTL = {
  matches: 2 * 3600, // fixtures: refreshed every 2 hours at most, to leave quota for scorecards
  matchInfo: 5 * 60,
  squad: 6 * 3600,
  player: 7 * 24 * 3600,
  scorecard: 24 * 3600,
};

/** The keys in order of use: the main key, then an optional backup key from another account (CRICKETDATA_API_KEY_2). */
const keys = () => [process.env.CRICKETDATA_API_KEY, process.env.CRICKETDATA_API_KEY_2].filter((k): k is string => !!k);
const today = () => new Date().toISOString().slice(0, 10);

// The main key keeps its original counter (table api_usage); a backup key counts in api_cache.
async function hitsFor(sb: SupabaseClient, i: number): Promise<number> {
  if (i === 0) return (await sb.from('api_usage').select('hits').eq('day', today()).maybeSingle()).data?.hits ?? 0;
  return (await sb.from('api_cache').select('payload').eq('key', `cd:usage${i}:${today()}`).maybeSingle()).data?.payload?.hits ?? 0;
}
async function setHits(sb: SupabaseClient, i: number, hits: number) {
  if (i === 0) await sb.from('api_usage').upsert({ day: today(), hits });
  else await sb.from('api_cache').upsert({ key: `cd:usage${i}:${today()}`, payload: { hits }, fetched_at: new Date().toISOString(), ttl_seconds: 2 * 86400 });
}

/** Calls used today across all keys, against the combined budget. */
export async function usageToday(sb: SupabaseClient): Promise<{ hits: number; limit: number; keys: number }> {
  const n = Math.max(1, keys().length);
  const all = await Promise.all(Array.from({ length: n }, (_, i) => hitsFor(sb, i)));
  return { hits: all.reduce((a, b) => a + b, 0), limit: limit() * n, keys: n };
}

/**
 * Every CricketData call goes through here: Supabase-cached, counted against a daily budget per key
 * (default 95 of the free 100), and server-side only because the key travels in the URL. When the main key is used
 * up it moves to the backup key. Over budget on every key (or on API failure) we serve stale cache; if there is none
 * we throw so the UI can fall back to manual entry.
 */
export async function cricket<T = any>(
  sb: SupabaseClient,
  endpoint: string,
  params: Record<string, string>,
  ttl: number,
  force = false,
  essential = false, // scorecards for results / history top-up: allowed to use the reserved part of the daily quota
): Promise<{ data: T; fromCache: boolean; stale: boolean }> {
  const key = `cd:${endpoint}:${new URLSearchParams(params).toString()}`;
  const { data: row } = await sb.from('api_cache').select('payload,fetched_at,ttl_seconds').eq('key', key).maybeSingle();
  const age = row ? (Date.now() - new Date(row.fetched_at).getTime()) / 1000 : Infinity;
  if (row && age < ttl && !force) return { data: row.payload as T, fromCache: true, stale: false };

  const serveStale = (why: string) => {
    if (row) return { data: row.payload as T, fromCache: true, stale: true };
    throw new HttpError(503, why, { manualFallback: true });
  };
  const list = keys();
  if (!list.length) return serveStale('CRICKETDATA_API_KEY is not set. Enter this data manually.');

  const used = await Promise.all(list.map((_, i) => hitsFor(sb, i)));
  let lastWhy = '';
  for (let tries = 0; tries < list.length; tries++) {
    const i = pickKey(used, limit(), essential);
    if (i < 0) break;
    const qs = new URLSearchParams({ apikey: list[i], ...params });
    let json: any;
    try {
      const res = await fetch(`${BASE}/${endpoint}?${qs}`, { cache: 'no-store' });
      if (i === 0) await sb.rpc('bump_api_usage', { n: 1 });
      else await setHits(sb, i, used[i] + 1);
      json = await res.json();
    } catch {
      return serveStale('CricketData is unreachable. Enter this data manually.');
    }
    used[i] += 1;
    // Trust the usage CricketData itself reports: other tools and scripts share a key, so our own counter can under-count.
    const reported = Number(json?.info?.hitsToday);
    if (Number.isFinite(reported) && reported > used[i]) { used[i] = reported; await setHits(sb, i, reported); }
    if (json?.status && json.status !== 'success') {
      lastWhy = `CricketData: ${json.reason ?? json.status}`;
      if (/exceed|limit/i.test(String(json.reason ?? ''))) { used[i] = limit(); await setHits(sb, i, limit()); continue; } // this key is used up: try the next one
      return serveStale(lastWhy);
    }
    await sb.from('api_cache').upsert({ key, payload: json, fetched_at: new Date().toISOString(), ttl_seconds: ttl });
    return { data: json as T, fromCache: false, stale: false };
  }
  return serveStale(lastWhy || (essential ? `Daily CricketData budget used (${used.join('/')} of ${limit()} per key). Enter this data manually.` : `CricketData budget is being kept for scorecards (${used.join('/')} of ${limit()} per key used today).`));
}

export function formatOf(matchType?: string): 'T20' | 'ODI' | 'TEST' {
  const t = (matchType ?? '').toLowerCase();
  if (t.includes('odi')) return 'ODI';
  if (t.includes('test')) return 'TEST';
  return 'T20';
}
