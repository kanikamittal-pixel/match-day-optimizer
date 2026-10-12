import type { SupabaseClient } from '@supabase/supabase-js';
import { cricket, TTL } from '@/backend/integrations/cricketdata';

/**
 * Overall (career) stats from CricketData. Honest limits, measured on a real squad:
 *  - only ~3 of 11 players had usable T20 numbers (the rest are blank in that API);
 *  - names must match exactly (surname + first initial + country), otherwise we show nothing rather than
 *    risk another player's stats;
 *  - there is NO recent-form (last 10) data in any available source.
 */
export interface PlayerStats {
  found: boolean;
  full_name?: string;
  matches?: number;
  runs?: number;
  batting_avg?: number | null;
  strike_rate?: number | null;
  wickets?: number;
  bowling_avg?: number | null;
  economy?: number | null;
  scope?: string;
  note?: string;
}

const num = (v: unknown): number | null => {
  const n = parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : null;
};
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const wanted = (format: string) => (format === 'ODI' ? ['odi'] : format === 'TEST' ? ['test'] : ['t20i', 't20']);

type Row = { fn: string; matchtype: string; stat: string; value: string };

export function summarise(rows: Row[], format: string): Omit<PlayerStats, 'found' | 'full_name'> | null {
  for (const mt of wanted(format)) {
    const r = rows.filter((x) => x.matchtype?.toLowerCase() === mt);
    const g = (fn: string, stat: string) => r.find((x) => x.fn === fn && x.stat === stat)?.value;
    const matches = num(g('batting', 'm')) ?? num(g('bowling', 'm'));
    if (!matches) continue;
    return {
      matches,
      runs: num(g('batting', 'runs')) ?? 0,
      batting_avg: num(g('batting', 'avg')),
      strike_rate: num(g('batting', 'sr')),
      wickets: num(g('bowling', 'wkts')) ?? 0,
      bowling_avg: num(g('bowling', 'avg')),
      economy: num(g('bowling', 'econ')),
      scope: `${mt.toUpperCase()} career`,
    };
  }
  return null;
}

export async function careerStatsFor(sb: SupabaseClient, p: { name: string; team: string }, format: string): Promise<PlayerStats> {
  const clean = p.name.replace(/\(.*?\)/g, '').replace(/[.…]/g, '').trim();
  const parts = clean.split(/\s+/);
  const surname = parts[parts.length - 1];
  if (!surname || surname.length < 3) return { found: false, note: 'Name too short to search' };
  try {
    const s = await cricket<any>(sb, 'players', { offset: '0', search: surname }, TTL.player);
    const all: { id: string; name: string; country: string }[] = s.data.data ?? [];
    const initial = parts.length > 1 ? parts[0][0]?.toLowerCase() : '';
    const pool = all.filter((c) => norm(c.country ?? '') === norm(p.team) || norm(p.team).startsWith(norm(c.country ?? '~')));
    if (!pool.length) return { found: false, note: `No ${surname} listed for ${p.team}` };
    const exact = pool.filter((c) => {
      const t = c.name.toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/).filter(Boolean);
      return t[t.length - 1] === surname.toLowerCase() && (!initial || t[0]?.[0] === initial);
    });
    if (exact.length !== 1) return { found: false, note: exact.length ? 'Several players match this name' : 'No exact match for this name' };
    const info = await cricket<any>(sb, 'players_info', { id: exact[0].id }, TTL.player);
    const d = info.data.data ?? {};
    const sum = summarise(d.stats ?? [], format);
    if (!sum) return { found: false, full_name: d.name, note: `${d.name} has no ${format} career numbers in the API` };
    return { found: true, full_name: d.name ?? exact[0].name, ...sum };
  } catch (e: any) {
    return { found: false, note: e?.extra?.manualFallback ? 'API budget used for today' : 'Stats lookup failed' };
  }
}

export function describeStats(s?: PlayerStats): string {
  if (!s?.found) return 'OVERALL: not available. RECENT (last 10): not available';
  const bat = `${s.matches} matches, ${s.runs} runs, avg ${s.batting_avg ?? '-'}, SR ${s.strike_rate ?? '-'}`;
  const bowl = s.wickets ? `, ${s.wickets} wkts, bowl avg ${s.bowling_avg ?? '-'}, eco ${s.economy ?? '-'}` : '';
  return `OVERALL (${s.scope}): ${bat}${bowl}. RECENT (last 10): not available, do not assume or invent recent form`;
}
