/**
 * One-off / periodic import of Cricsheet T20 ball-by-ball data into Supabase as Dream11 points per player-match.
 *
 *   npm run ingest:cricsheet                         # T20 internationals + the major T20 leagues since 2018 (~50 MB from cricsheet.org)
 *   npm run ingest:cricsheet -- --zip recently_added_7_json.zip   # keep it fresh: the small 7-day file
 *   npm run ingest:cricsheet -- --since 2022-01-01 --dry          # parse only, write nothing
 *
 * Reads SUPABASE_URL / SUPABASE_ANON_KEY from .env.local. Data: Cricsheet (ODC-BY): credit it wherever shown.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAliases, ingestZip, saveAliases } from '../services/cricsheet-ingest';

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

// Cricsheet's `t20s` file holds T20 INTERNATIONALS only. Leagues are separate files.
const DEFAULT_ZIPS = ['t20s', 'ipl', 'bbl', 'wbb', 'psl', 'cpl', 'sat', 'ilt', 'lpl', 'bpl', 'mlc', 'ntb', 'msl', 'wpl', 'sma'];

async function getZip(src: string): Promise<Buffer> {
  if (/^https?:/.test(src)) return downloadTo(src);
  if (existsSync(src)) return readFileSync(src);
  return downloadTo(src.endsWith('.zip') ? `https://cricsheet.org/downloads/${src}` : `https://cricsheet.org/downloads/${src}_json.zip`);
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
  const sources = arg('zip', DEFAULT_ZIPS.join(','))!.split(',').map((x) => x.trim()).filter(Boolean);
  const since = arg('since', '2018-01-01')!;
  const limit = Number(arg('limit', '0'));
  const dry = flag('dry');
  const sb = dry ? null : createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  console.log(`Keeping T20s played on/after ${since}${dry ? ' (dry run)' : ''} from: ${sources.join(', ')}`);

  const idByName = new Map<string, Set<string>>();
  let matches = 0, rows = 0;
  for (const src of sources) {
    const zip = await getZip(src);
    const stats = await ingestZip(zip, { since, sb, limit, onProgress: (m, r) => process.stdout.write(`\r  ${src}: ${m} matches, ${r} rows`) });
    console.log(`\r  ${src}: ${stats.matches} matches, ${stats.rows} rows ${dry ? '(not written)' : 'written'}${' '.repeat(10)}`);
    matches += stats.matches; rows += stats.rows;
    for (const [name, ids] of stats.idByName) { if (!idByName.has(name)) idByName.set(name, new Set()); ids.forEach((i) => idByName.get(name)!.add(i)); }
  }
  console.log(`Done: ${matches} matches, ${rows} player-match rows`);

  // Name aliases (full names for the short names Dream11 shows), from Cricsheet's register
  const res = await fetch('https://cricsheet.org/register/names.csv');
  if (res.ok) {
    const aliases = buildAliases(await res.text(), idByName);
    console.log(`${Object.keys(aliases).length} players have alternative names${dry ? '' : ' (saved)'}`);
    if (sb) await saveAliases(sb, aliases);
  } else console.warn(`Could not fetch names.csv (${res.status}); name matching will use initials only`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
