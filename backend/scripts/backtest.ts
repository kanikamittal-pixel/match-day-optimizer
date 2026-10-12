/**
 * Back-test the prediction logic on matches that have already been played.
 *   npm run backtest -- 1529230 1552779 1552776
 * Saves each result to Supabase so the Insights page can show it. Needs the Cricsheet history imported.
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { runBacktest, saveBacktest } from '../services/backtest';

function loadEnv() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}

async function main() {
  loadEnv();
  const li = process.argv.indexOf('--logic');
  const logic = (li >= 0 ? process.argv[li + 1] : 'v2') as 'v1' | 'v2';
  const refs = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--logic');
  if (!refs.length) throw new Error('Usage: npm run backtest -- <cricsheet match id> [...]');
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  for (const ref of refs) {
    console.log(`\n=== ${ref}`);
    const rec = await runBacktest(sb, ref, logic);
    await saveBacktest(sb, rec);
    const m = rec.metrics;
    console.log(`${rec.title} (${rec.date})  logic ${rec.logic}`);
    console.log(`  our XI ${m.agent} | last-5 baseline XI ${m.baseline} | best possible ${m.hindsight} (we got ${m.agentPctOfHindsight}%)`);
    console.log(`  captain ${rec.agent.captain}: ${m.captainActual} pts, #${m.captainRank} of ${rec.players.length}`);
    console.log(`  player error: ours ${m.maeAgent} vs last-5 baseline ${m.maeBaseline} (n=${m.nBaseline})`);
    console.log(`  formula check (no Gemini): old base team ${rec.formulaCheck.v1.points} pts (miss ${rec.formulaCheck.v1.mae}) | new base team ${rec.formulaCheck.v2.points} pts (miss ${rec.formulaCheck.v2.mae})`);
    for (const f of rec.findings) console.log(`  [${f.severity}] ${f.text}`);
  }
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
