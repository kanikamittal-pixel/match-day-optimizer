/**
 * One-off / periodic import of Cricsheet T20 ball-by-ball data into Supabase as Dream11 points per player-match.
 *
 *   npm run ingest:cricsheet                         # all T20s since 2018 (downloads ~23 MB from cricsheet.org)
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

  const zip = await getZip(src);
  console.log(`Keeping T20s played on/after ${since}${dry ? ' (dry run)' : ''}`);
  const stats = await ingestZip(zip, { since, sb, limit, onProgress: (m, r) => process.stdout.write(`\r  ${m} matches, ${r} rows`) });
  console.log(`\nDone: ${stats.matches} matches parsed, ${stats.rows} player-match rows ${dry ? 'would be written' : 'written'}; ${stats.skipped} skipped`, stats.skips);

  // Name aliases (full names for the short names Dream11 shows), from Cricsheet's register
  const res = await fetch('https://cricsheet.org/register/names.csv');
  if (res.ok) {
    const aliases = buildAliases(await res.text(), stats.idByName);
    console.log(`${Object.keys(aliases).length} players have alternative names${dry ? '' : ' (saved)'}`);
    if (sb) await saveAliases(sb, aliases);
  } else console.warn(`Could not fetch names.csv (${res.status}); name matching will use initials only`);
}

main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
