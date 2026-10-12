/**
 * Backup of everything stored in Supabase, as one JSON file per table in backups/<timestamp>/.
 *   npm run backup
 * Restore is a plain upsert of those rows (tables are listed in order, parents before children).
 * api_cache is included because it holds back-tests (bt:*), Proof screenshots (proof:*) and recommendation snapshots (rec:*).
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const TABLES: { name: string; order: string[] }[] = [
  { name: 'matches', order: ['id'] },
  { name: 'players', order: ['name_key'] },
  { name: 'match_credits', order: ['match_id', 'name_key'] },
  { name: 'predictions', order: ['id'] },
  { name: 'team_decisions', order: ['match_id'] },
  { name: 'actual_points', order: ['match_id', 'name_key'] },
  { name: 'rules_config', order: ['id'] },
  { name: 'scoring_weights', order: ['version'] },
  { name: 'playbook_rules', order: ['id'] },
  { name: 'weight_suggestions', order: ['id'] },
  { name: 'player_match_points', order: ['match_ref', 'team', 'name_key'] },
  { name: 'api_usage', order: ['day'] },
  { name: 'api_cache', order: ['key'] },
];

function loadEnv() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

async function main() {
  loadEnv();
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const dir = `backups/${new Date().toISOString().replace(/[:.]/g, '-')}`;
  mkdirSync(dir, { recursive: true });
  for (const t of TABLES) {
    const rows: any[] = [];
    for (let from = 0; ; from += 1000) {
      let q: any = sb.from(t.name).select('*').range(from, from + 999);
      for (const c of t.order) q = q.order(c);
      const { data, error } = await q;
      if (error) { console.log(`${t.name}: skipped (${error.message})`); break; }
      rows.push(...(data ?? []));
      if (!data || data.length < 1000) break;
    }
    writeFileSync(`${dir}/${t.name}.json`, JSON.stringify(rows));
    console.log(`${t.name}: ${rows.length} rows`);
  }
  console.log(`Saved to ${dir}`);
}
main();
