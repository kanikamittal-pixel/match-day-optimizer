import type { SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '@/backend/http';
import { callAllowed } from '@/shared/budget';

const BASE = 'https://api.cricapi.com/v1';
const limit = () => Number(process.env.CRICKETDATA_DAILY_LIMIT || 95);

export const TTL = {
  matches: 2 * 3600, // fixtures: refreshed every 2 hours at most, to leave quota for scorecards
  matchInfo: 5 * 60,
  squad: 6 * 3600,
  player: 7 * 24 * 3600,
  scorecard: 24 * 3600,
};

export async function usageToday(sb: SupabaseClient): Promise<{ hits: number; limit: number }> {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await sb.from('api_usage').select('hits').eq('day', day).maybeSingle();
  return { hits: data?.hits ?? 0, limit: limit() };
}

/**
 * Every CricketData call goes through here: Supabase-cached, counted against a daily budget
 * (default 95 of the free 100), and server-side only because the key travels in the URL.
 * Over budget (or on API failure) we serve stale cache; if there is none we throw so the UI
 * can fall back to manual entry.
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

  const apikey = process.env.CRICKETDATA_API_KEY;
  const serveStale = (why: string) => {
    if (row) return { data: row.payload as T, fromCache: true, stale: true };
    throw new HttpError(503, why, { manualFallback: true });
  };
  if (!apikey) return serveStale('CRICKETDATA_API_KEY is not set. Enter this data manually.');

  const { hits } = await usageToday(sb);
  if (!callAllowed(hits, limit(), essential)) return serveStale(essential ? `Daily CricketData budget used (${hits}/${limit()}). Enter this data manually.` : `CricketData budget is being kept for scorecards (${hits}/${limit()} used today).`);

  const qs = new URLSearchParams({ apikey, ...params });
  let json: any;
  try {
    const res = await fetch(`${BASE}/${endpoint}?${qs}`, { cache: 'no-store' });
    await sb.rpc('bump_api_usage', { n: 1 });
    json = await res.json();
  } catch {
    return serveStale('CricketData is unreachable. Enter this data manually.');
  }
  // Trust the usage CricketData itself reports: other tools and scripts share this key, so our own counter can under-count.
  const reported = Number(json?.info?.hitsToday);
  if (Number.isFinite(reported) && reported > hits + 1) {
    const day = new Date().toISOString().slice(0, 10);
    await sb.from('api_usage').upsert({ day, hits: reported });
  }
  if (json?.status && json.status !== 'success') {
    if (/exceed/i.test(String(json.reason ?? ''))) await sb.from('api_usage').upsert({ day: new Date().toISOString().slice(0, 10), hits: limit() });
    return serveStale(`CricketData: ${json.reason ?? json.status}`);
  }
  await sb.from('api_cache').upsert({ key, payload: json, fetched_at: new Date().toISOString(), ttl_seconds: ttl });
  return { data: json as T, fromCache: false, stale: false };
}

export function formatOf(matchType?: string): 'T20' | 'ODI' | 'TEST' {
  const t = (matchType ?? '').toLowerCase();
  if (t.includes('odi')) return 'ODI';
  if (t.includes('test')) return 'TEST';
  return 'T20';
}
