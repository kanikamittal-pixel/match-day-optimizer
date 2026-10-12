/**
 * Accuracy audit of the "recent form" numbers. The same players in the same match are scored from TWO independent
 * providers and compared:
 *   A. Cricsheet ball-by-ball (what the app uses)           -> table player_match_points
 *   B. CricketData scorecards (a different company's feed)  -> scored with the same Dream11 table
 * Differences are expected where B lacks information (dot balls are estimated; run-outs cannot be split into
 * direct/indirect), so the audit also reports how big those differences are.
 *   npm run audit:form
 * Saves to Supabase key bt:audit for the Insights page.
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { aggregatesFromScorecard } from '../services/scorecard';
import { scoreAgg } from '../../shared/scoring';
import { matchStrictAliases } from '../../shared/names';
import { mean } from '../../shared/stats';

function loadEnv() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}
const pearson = (x: number[], y: number[]) => {
  const mx = mean(x), my = mean(y);
  let n = 0, a = 0, b = 0;
  for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); a += (x[i] - mx) ** 2; b += (y[i] - my) ** 2; }
  return a && b ? n / Math.sqrt(a * b) : NaN;
};
const r1 = (n: number) => Math.round(n * 10) / 10;

const PAIRS = [
  { ref: '1548904', file: 'tests/fixtures/scorecard.json', title: "Sri Lanka Women v Pakistan Women, Women's Asia Cup semi-final, 11 Sep 2026" },
];

async function main() {
  loadEnv();
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const { data: aliasRow } = await sb.from('api_cache').select('payload').eq('key', 'cs:aliases').maybeSingle();
  const aliases: Record<string, string[]> = aliasRow?.payload?.aliases ?? {};
  const matches: any[] = [];

  for (const p of PAIRS) {
    const { data: cs } = await sb.from('player_match_points').select('player,team,points,bat_pos').eq('match_ref', p.ref);
    const card = JSON.parse(readFileSync(p.file, 'utf8')).data.scorecard;
    const roster = (cs ?? []).map((r: any) => r.player as string);
    const truth = new Map<string, number>((cs ?? []).map((r: any) => [r.player, Number(r.points)]));
    const rows: { player: string; cricsheet: number; cricketdata: number; noDots: number; diff: number }[] = [];
    const unmatched: string[] = [];
    const withDots = aggregatesFromScorecard(card, { estimateDots: true });
    const withoutDots = aggregatesFromScorecard(card);
    for (const [name, agg] of withDots) {
      const canon = roster.includes(name) ? name : matchStrictAliases(name, roster, aliases);
      if (!canon || !truth.has(canon)) { unmatched.push(name); continue; }
      const pos = (cs ?? []).find((r: any) => r.player === canon)?.bat_pos ?? null;
      const role = agg.ballsBowled >= 12 && (pos === null || pos >= 8) ? 'BOWL' : undefined;
      const a = scoreAgg(agg, role);
      const b = scoreAgg(withoutDots.get(name)!, role);
      rows.push({ player: canon, cricsheet: truth.get(canon)!, cricketdata: r1(a), noDots: r1(b), diff: r1(a - truth.get(canon)!) });
    }
    const x = rows.map((r) => r.cricketdata), y = rows.map((r) => r.cricsheet);
    matches.push({
      ref: p.ref, title: p.title, players: rows.length, unmatched,
      mae: r1(mean(rows.map((r) => Math.abs(r.diff)))),
      maeWithoutDotEstimate: r1(mean(rows.map((r) => Math.abs(r.noDots - r.cricsheet)))),
      meanDiff: r1(mean(rows.map((r) => r.diff))),
      correlation: Math.round(pearson(x, y) * 1000) / 1000,
      within5: Math.round((rows.filter((r) => Math.abs(r.diff) <= 5).length / rows.length) * 100),
      within10: Math.round((rows.filter((r) => Math.abs(r.diff) <= 10).length / rows.length) * 100),
      biggest: [...rows].sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 5),
      rows: rows.sort((a, b) => b.cricsheet - a.cricsheet),
    });
  }
  const out = { generatedAt: new Date().toISOString(), matches };
  for (const m of matches) {
    console.log(`${m.title}: ${m.players} players compared, ${m.unmatched.length} unmatched ${m.unmatched.join(', ')}`);
    console.log(`  average difference ${m.mae} points (without the dot estimate ${m.maeWithoutDotEstimate}); CricketData reads ${m.meanDiff} on average; correlation ${m.correlation}; within 5 pts: ${m.within5}%, within 10 pts: ${m.within10}%`);
    for (const b of m.biggest) console.log(`  biggest: ${b.player}: Cricsheet ${b.cricsheet}, CricketData ${b.cricketdata} (${b.diff >= 0 ? '+' : ''}${b.diff})`);
  }
  await sb.from('api_cache').upsert({ key: 'bt:audit', payload: out, fetched_at: new Date().toISOString(), ttl_seconds: 3650 * 86400 });
  console.log('saved to bt:audit');
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
