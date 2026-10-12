import AdmZip from 'adm-zip';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseCricsheetMatch } from '@/backend/services/cricsheet';

/**
 * Shared by the command-line import (`npm run ingest:cricsheet`) and the daily refresh route
 * (`/api/cron/cricsheet`). Data: Cricsheet (https://cricsheet.org, ODC-BY licence).
 */
export interface IngestStats {
  matches: number;
  rows: number;
  skipped: number;
  skips: Record<string, number>;
  idByName: Map<string, Set<string>>; // match-name -> Cricsheet identifiers (to attach register aliases)
}

export async function ingestZip(
  buf: Buffer,
  opts: { since: string; sb: SupabaseClient | null; limit?: number; onProgress?: (matches: number, rows: number) => void },
): Promise<IngestStats> {
  const entries = new AdmZip(buf).getEntries().filter((e) => e.entryName.endsWith('.json'));
  const stats: IngestStats = { matches: 0, rows: 0, skipped: 0, skips: {}, idByName: new Map() };
  const skip = (why: string) => { stats.skipped++; stats.skips[why] = (stats.skips[why] ?? 0) + 1; };
  let batch: any[] = [];

  const flush = async () => {
    if (!batch.length) return;
    if (opts.sb) {
      const { error } = await opts.sb.from('player_match_points').upsert(batch, { onConflict: 'match_ref,team,name_key' });
      if (error) throw new Error(`Supabase: ${error.message} (did you run supabase/migrations/0004_player_match_points.sql?)`);
    }
    stats.rows += batch.length;
    batch = [];
  };

  for (const e of entries) {
    if (opts.limit && stats.matches >= opts.limit) break;
    let json: any;
    try { json = JSON.parse(e.getData().toString('utf8')); } catch { skip('bad json'); continue; }
    const ref = e.entryName.replace(/\.json$/, '').split('/').pop()!;
    const date = String(json?.info?.dates?.[0] ?? '');
    if (date < opts.since) { skip('before --since'); continue; }
    const m = parseCricsheetMatch(json, ref);
    if (m.skip !== undefined) { skip(m.skip); continue; }
    stats.matches++;
    for (const [name, id] of Object.entries<string>(json.info?.registry?.people ?? {})) {
      if (!stats.idByName.has(name)) stats.idByName.set(name, new Set());
      stats.idByName.get(name)!.add(id);
    }
    for (const r of m.rows) {
      batch.push({ match_ref: ref, team: r.team, name_key: r.name_key, player: r.player, opponent: r.opponent, played_on: m.playedOn, match_type: m.matchType, gender: m.gender, venue: m.venue, event: m.event, points: r.points, bat_pos: r.bat_pos });
    }
    if (batch.length >= 1000) { await flush(); opts.onProgress?.(stats.matches, stats.rows); }
  }
  await flush();
  return stats;
}

/** Cricsheet's register file `names.csv` (identifier,name): every spelling seen for each player. */
export function parseNamesCsv(csv: string): Map<string, string[]> {
  const byId = new Map<string, string[]>();
  for (const line of csv.split(/\r?\n/).slice(1)) {
    const i = line.indexOf(',');
    if (i < 1) continue;
    const id = line.slice(0, i);
    const name = line.slice(i + 1).replace(/^"|"$/g, '').trim();
    if (name) byId.set(id, [...(byId.get(id) ?? []), name]);
  }
  return byId;
}

/** canonical match-name -> other spellings (only for names that map to exactly one identifier) */
export function buildAliases(namesCsv: string, idByName: Map<string, Set<string>>): Record<string, string[]> {
  const byId = parseNamesCsv(namesCsv);
  const out: Record<string, string[]> = {};
  for (const [name, ids] of idByName) {
    if (ids.size !== 1) continue; // ambiguous name: never alias it
    const aliases = (byId.get([...ids][0]) ?? []).filter((a) => a !== name && !/\(\d+\)$/.test(a));
    if (aliases.length) out[name] = [...new Set(aliases)];
  }
  return out;
}

const ALIAS_KEY = 'cs:aliases';

export async function saveAliases(sb: SupabaseClient, fresh: Record<string, string[]>): Promise<number> {
  const { data } = await sb.from('api_cache').select('payload').eq('key', ALIAS_KEY).maybeSingle();
  const merged = { ...(data?.payload?.aliases ?? {}), ...fresh };
  const { error } = await sb.from('api_cache').upsert({ key: ALIAS_KEY, payload: { aliases: merged }, fetched_at: new Date().toISOString(), ttl_seconds: 365 * 86400 });
  if (error) throw new Error(`Supabase: ${error.message}`);
  return Object.keys(merged).length;
}

let aliasMemo: { at: number; map: Record<string, string[]> } | null = null;
export async function loadAliases(sb: SupabaseClient): Promise<Record<string, string[]>> {
  if (aliasMemo && Date.now() - aliasMemo.at < 10 * 60 * 1000) return aliasMemo.map;
  const { data } = await sb.from('api_cache').select('payload').eq('key', ALIAS_KEY).maybeSingle();
  aliasMemo = { at: Date.now(), map: (data?.payload?.aliases ?? {}) as Record<string, string[]> };
  return aliasMemo.map;
}
