/**
 * The daily top-up copies finished matches from CricketData scorecards (full names) until Cricsheet publishes them.
 * Before the name matching was improved, some of those players were stored under a spelled-out name ("Kusal Mendis")
 * while the rest of their history sits under Cricsheet's name ("BKG Mendis"), splitting one player's history in two.
 * This renames those rows to the Cricsheet name.
 *   npm run repair:names            (dry run: shows what would change)
 *   npm run repair:names -- --apply
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { linkRoster, nameKey } from '../../shared/names';
import { loadAliases } from '../services/cricsheet-ingest';

function loadEnv() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

async function main() {
  loadEnv();
  const apply = process.argv.includes('--apply');
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const aliases = await loadAliases(sb);
  const { data: cd } = await sb.from('player_match_points').select('match_ref,team,name_key,player,gender,played_on').like('match_ref', 'cd-%').order('match_ref').order('team').order('name_key');
  const teams = [...new Set((cd ?? []).map((r: any) => `${r.team}|${r.gender}`))];
  let changes = 0;
  for (const tg of teams) {
    const [team, gender] = tg.split('|');
    const rows = (cd ?? []).filter((r: any) => r.team === team && r.gender === gender);
    const { data: ro } = await sb.from('player_match_points').select('player').eq('team', team).eq('gender', gender).not('match_ref', 'like', 'cd-%').order('played_on', { ascending: false }).order('match_ref').order('team').order('name_key').limit(1500);
    const roster = [...new Set((ro ?? []).map((r: any) => r.player as string))];
    const names = [...new Set(rows.map((r: any) => r.player as string))];
    const links = linkRoster(names.map((n) => ({ key: n, names: [n] })), roster, aliases);
    for (const n of names) {
      const canon = links.get(n);
      if (!canon || canon === n) continue;
      const mine = rows.filter((r: any) => r.player === n);
      console.log(`${team}: "${n}" -> "${canon}" (${mine.length} row${mine.length === 1 ? '' : 's'})`);
      changes += mine.length;
      if (!apply) continue;
      for (const r of mine) {
        const { error } = await sb.from('player_match_points').update({ player: canon, name_key: nameKey(canon) }).eq('match_ref', r.match_ref).eq('team', r.team).eq('name_key', r.name_key);
        if (error) console.log('  failed:', error.message);
      }
    }
  }
  console.log(`${changes} row(s) ${apply ? 'renamed' : 'would be renamed (add --apply)'}`);
}
main();
