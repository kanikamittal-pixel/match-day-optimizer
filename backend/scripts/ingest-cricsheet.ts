/**
 * One-off / periodic import of Cricsheet T20 ball-by-ball data into Supabase as Dream11 points per player-match.
 *
 *   npm run ingest:cricsheet                         # all T20s since 2018 (downloads ~23 MB from cricsheet.org)
 *   npm run ingest:cricsheet -- --zip recently_added_7_json.zip   # keep it fresh: the small 7-day file
 *   npm run ingest:cricsheet -- --since 2022-01-01 --dry          # parse only, write nothing
 *
 * Reads SUPABASE_URL / SUPABASE_ANON_KEY from .env.local. Data: Cricsheet (ODC-BY): credit it wherever shown.
 */
import AdmZip from 'adm-zip';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCricsheetMatch } from '../services/cricsheet';

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] ?? 'true' : def;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

function loadEnv() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

async function getZip(src: string): Promise<Buffer> {
  if (/^https?:/.test(src)) return downloadTo(src);
  if (existsSync(src)) return readFileSync(src);
  return downloadTo(`https://cricsheet.org/downloads/${src}`);
}
async function downloadTo(url: string): Promise<Buffer> {
  console.log(`Downloading ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(join(tmpdir(), 'cricsheet.zip'), buf);
  console.log(`  ${(buf.length / 1e6).toFixed(1)} MB`);
  return buf;
}

async function main() {
  loadEnv();
  const src = arg('zip', 'https://cricsheet.org/downloads/t20s_json.zip')!;
  const since = arg('since', '2018-01-01')!;
  const limit = Number(arg('limit', '0'));
  const dry = flag('dry');
  const sb = dry ? null : createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

  const zip = new AdmZip(await getZip(src));
  const entries = zip.getEntries().filter((e) => e.entryName.endsWith('.json'));
  console.log(`${entries.length} matches in the file; keeping T20s played on/after ${since}${dry ? ' (dry run)' : ''}`);

  let kept = 0, skipped = 0, written = 0;
  const skips: Record<string, number> = {};
  let batch: any[] = [];
  const flush = async () => {
    if (!batch.length || !sb) { written += batch.length; batch = []; return; }
    const { error } = await sb.from('player_match_points').upsert(batch, { onConflict: 'match_ref,team,name_key' });
    if (error) throw new Error(`Supabase: ${error.message} (did you run supabase/migrations/0004_player_match_points.sql?)`);
    written += batch.length;
    batch = [];
  };

  for (const e of entries) {
    if (limit && kept >= limit) break;
    let json: any;
    try { json = JSON.parse(e.getData().toString('utf8')); } catch { skipped++; skips['bad json'] = (skips['bad json'] ?? 0) + 1; continue; }
    const ref = e.entryName.replace(/\.json$/, '').split('/').pop()!;
    const date = String(json?.info?.dates?.[0] ?? '');
    if (date < since) { skipped++; skips['before --since'] = (skips['before --since'] ?? 0) + 1; continue; }
    const m = parseCricsheetMatch(json, ref);
    if (m.skip !== undefined) { skipped++; skips[m.skip] = (skips[m.skip] ?? 0) + 1; continue; }
    kept++;
    for (const r of m.rows) {
      batch.push({ match_ref: ref, team: r.team, name_key: r.name_key, player: r.player, opponent: r.opponent, played_on: m.playedOn, match_type: m.matchType, gender: m.gender, venue: m.venue, event: m.event, points: r.points, bat_pos: r.bat_pos });
    }
    if (batch.length >= 1000) { await flush(); process.stdout.write(`\r  ${kept} matches, ${written} rows`); }
  }
  await flush();
  console.log(`\nDone: ${kept} matches parsed, ${written} player-match rows ${dry ? 'would be written' : 'written'}; ${skipped} skipped`, skips);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
