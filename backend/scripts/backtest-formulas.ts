/**
 * Large-scale, no-AI back-test of ways to compute a player's expected fantasy points.
 * For every match played on/after --from, each player's estimate uses ONLY matches played before that day.
 *   npm run backtest:formulas -- --from 2026-01-01
 * Saves the comparison to Supabase (key bt:formulas) for the Insights page.
 */
import { createClient } from '@supabase/supabase-js';
import { existsSync, readFileSync } from 'node:fs';
import { bootstrapCI, mean, spearman } from '../../shared/stats';
import { blendBase, blendBaseLegacy, ewmMean } from '../../shared/form';

function loadEnv() {
  if (!existsSync('.env.local')) return;
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
  }
}
const arg = (n: string, d: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : d; };

interface Row { match_ref: string; player: string; team: string; played_on: string; points: number; bat_pos: number | null; gender: string }
const median = (xs: number[]) => { if (!xs.length) return NaN; const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

// ---- the estimators under test. `all` and `rec` are fantasy points, newest FIRST. `prior` = the player's group average.
type Est = (all: number[], rec: number[], prior: number) => number | null;
const ok = (all: number[], rec: number[]) => all.length >= 5 && rec.length >= 3;
const shrink = (m: number, n: number, prior: number, k: number) => (n * m + k * prior) / (n + k);
const robust = (xs: number[]) => 0.5 * mean(xs) + 0.5 * median(xs);

export const ESTIMATORS: { id: string; label: string; f: Est }[] = [
  { id: 'v1', label: 'Current: 50% career mean + 50% last-10 mean', f: (a, r) => (ok(a, r) ? 0.5 * mean(a) + 0.5 * mean(r) : null) },
  { id: 'career', label: 'Career mean only', f: (a, r) => (ok(a, r) ? mean(a) : null) },
  { id: 'recent', label: 'Last-10 mean only', f: (a, r) => (ok(a, r) ? mean(r) : null) },
  { id: 'last5', label: 'Last-5 mean only (the baseline)', f: (a, r) => (ok(a, r) ? mean(r.slice(0, 5)) : null) },
  { id: 'median', label: '50/50 of career and last-10 MEDIANS', f: (a, r) => (ok(a, r) ? 0.5 * median(a) + 0.5 * median(r) : null) },
  { id: 'robust', label: '50/50 blend, each side = half mean + half median', f: (a, r) => (ok(a, r) ? 0.5 * robust(a) + 0.5 * robust(r) : null) },
  { id: 'shrunk', label: '50/50 blend, each side pulled toward the role average (k=10 / 5)', f: (a, r, p) => (ok(a, r) ? 0.5 * shrink(mean(a), a.length, p, 10) + 0.5 * shrink(mean(r), r.length, p, 5) : null) },
  { id: 'robust_shrunk', label: '50/50 blend, half mean + half median, pulled toward the role average', f: (a, r, p) => (ok(a, r) ? 0.5 * shrink(robust(a), a.length, p, 10) + 0.5 * shrink(robust(r), r.length, p, 5) : null) },
  { id: 'ewm', label: '50% career mean + 50% recency-weighted (last 20, half-life 5)', f: (a, r) => {
      if (!ok(a, r)) return null;
      const last = a.slice(0, 20); let w = 0, s = 0;
      last.forEach((x, i) => { const wi = Math.pow(0.5, i / 5); w += wi; s += wi * x; });
      return 0.5 * mean(a) + 0.5 * (s / w);
    } },
];

async function main() {
  loadEnv();
  const from = arg('from', '2026-01-01');
  const to = arg('to', '9999-12-31'); // optional end date, for checking stability across periods
  const save = !process.argv.includes('--nosave');
  const storeKey = arg('key', 'bt:formulas');
  const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);
  const rows: Row[] = [];
  process.stdout.write('Loading history');
  for (let off = 0; ; off += 1000) {
    const { data, error } = await sb.from('player_match_points').select('match_ref,player,team,played_on,points,bat_pos,gender').not('match_ref', 'like', 'cd-%').order('played_on', { ascending: true }).order('match_ref').order('team').order('name_key').range(off, off + 999);
    if (error) throw new Error(error.message);
    rows.push(...(data as Row[]).map((r) => ({ ...r, points: Number(r.points) })));
    if (off % 20000 === 0) process.stdout.write('.');
    if (!data || data.length < 1000) break;
  }
  console.log(` ${rows.length} rows`);

  // per-player history, oldest first
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(`${r.gender}|${r.player}`, [...(by.get(`${r.gender}|${r.player}`) ?? []), r]);
  // pseudo-role from batting position (Cricsheet has no roles): mostly bats 8+/not at all = "bowler-like"
  const grp = (hist: Row[]) => {
    const bowlish = hist.filter((h) => h.bat_pos === null || h.bat_pos >= 8).length / Math.max(1, hist.length);
    const avgPos = mean(hist.filter((h) => h.bat_pos).map((h) => h.bat_pos as number));
    return bowlish >= 0.6 ? 'bowler-like' : avgPos <= 3 ? 'top-order' : avgPos <= 6 ? 'middle-order' : 'lower-order';
  };
  // role averages from BEFORE the test window only (no peeking)
  const priorRows = rows.filter((r) => r.played_on < from);
  const gsum = new Map<string, number[]>();
  for (const [, h] of by) { const past = h.filter((x) => x.played_on < from); if (past.length >= 5) gsum.set(grp(past), [...(gsum.get(grp(past)) ?? []), ...past.map((x) => x.points)]); }
  const prior = new Map([...gsum].map(([g, v]) => [g, mean(v)]));
  const globalPrior = mean(priorRows.map((r) => r.points));
  console.log('Role averages (before the test window):', Object.fromEntries([...prior].map(([k, v]) => [k, Math.round(v * 10) / 10])), 'global', Math.round(globalPrior * 10) / 10);

  const matches = new Map<string, Row[]>();
  for (const r of rows) if (r.played_on >= from && r.played_on <= to) matches.set(r.match_ref, [...(matches.get(r.match_ref) ?? []), r]);

  const perVariant = new Map<string, { abs: number[]; bias: number[]; sp: number[]; top11: number[]; cap3: number[]; capPts: number[] }>();
  ESTIMATORS.forEach((e) => perVariant.set(e.id, { abs: [], bias: [], sp: [], top11: [], cap3: [], capPts: [] }));
  const matchOrder: string[] = [];
  const oracle: number[] = [];
  const groupBias = new Map<string, Map<string, number[]>>();

  for (const [ref, mrows] of matches) {
    const day = mrows[0].played_on;
    const pl = mrows.map((r) => {
      const hist = (by.get(`${r.gender}|${r.player}`) ?? []).filter((h) => h.played_on < day);
      const all = hist.map((h) => h.points).reverse();
      return { r, all, rec: all.slice(0, 10), g: hist.length >= 5 ? grp(hist) : 'lower-order' };
    });
    // only players every estimator can score, so the comparison is like-for-like
    const eligible = pl.filter((p) => ok(p.all, p.rec));
    if (eligible.length < 12) continue;
    matchOrder.push(ref);
    const act = eligible.map((p) => p.r.points);
    oracle.push([...act].sort((a, b) => b - a).slice(0, 11).reduce((s, x) => s + x, 0));
    for (const e of ESTIMATORS) {
      const est = eligible.map((p) => e.f(p.all, p.rec, prior.get(p.g) ?? globalPrior) as number);
      const v = perVariant.get(e.id)!;
      est.forEach((x, i) => { v.abs.push(Math.abs(x - act[i])); v.bias.push(x - act[i]); });
      const sp = spearman(est, act); if (Number.isFinite(sp)) v.sp.push(sp);
      const order = est.map((x, i) => [x, i] as const).sort((a, b) => b[0] - a[0]);
      v.top11.push(order.slice(0, 11).reduce((s, [, i]) => s + act[i], 0));
      const capIdx = order[0][1];
      const capRank = 1 + [...act].sort((a, b) => b - a).findIndex((x) => x === act[capIdx]);
      v.cap3.push(capRank <= 3 ? 1 : 0); v.capPts.push(act[capIdx]);
      if (e.id === 'v1' || e.id === 'robust_shrunk') {
        est.forEach((x, i) => { const g = eligible[i].g; const m = groupBias.get(e.id) ?? new Map(); m.set(g, [...(m.get(g) ?? []), x - act[i]]); groupBias.set(e.id, m); });
      }
    }
  }

  const buckets: [string, number, number][] = [['0 earlier matches', 0, 0], ['1-2', 1, 2], ['3-4', 3, 4], ['5-9', 5, 9], ['10-19', 10, 19], ['20+', 20, 9999]];
  const newPlayers = buckets.map(([label, lo, hi]) => ({ label, pts: [] as number[], lo, hi }));
  for (const [ref, mrows] of matches) {
    const day = mrows[0].played_on;
    for (const r of mrows) {
      const n = (by.get(`${r.gender}|${r.player}`) ?? []).filter((h) => h.played_on < day).length;
      const b = newPlayers.find((x) => n >= x.lo && n <= x.hi)!;
      b.pts.push(r.points);
    }
  }
  // Small samples: is a player's own tiny average better than the typical new-player score, or a mix of the two?
  const priorBy = (n: number) => { const b = newPlayers.find((x) => n >= x.lo && n <= x.hi)!; return mean(b.pts); };
  const small: { n: number; own: number; prior: number; actual: number }[] = [];
  for (const [, mrows] of matches) {
    const day = mrows[0].played_on;
    for (const r of mrows) {
      const h = (by.get(`${r.gender}|${r.player}`) ?? []).filter((x) => x.played_on < day);
      if (h.length >= 1 && h.length <= 4) small.push({ n: h.length, own: mean(h.map((x) => x.points)), prior: priorBy(h.length), actual: r.points });
    }
  }
  const smallTest = ['own', 'prior', 'k2', 'k4', 'k8'].map((m) => {
    const e = small.map((x) => (m === 'own' ? x.own : m === 'prior' ? x.prior : (x.n * x.own + Number(m.slice(1)) * x.prior) / (x.n + Number(m.slice(1)))));
    const err = e.map((v, i) => Math.abs(v - small[i].actual));
    return { method: m === 'own' ? "player's own average" : m === 'prior' ? 'typical score for that experience' : `mix: own average counts as ${m.slice(1)}-to-1 against the typical score`, mae: Math.round(mean(err) * 100) / 100 };
  });
  console.log('Players with 1-4 earlier matches (n=' + small.length + '):', smallTest.map((t) => `${t.method}: ${t.mae}`).join(' | '));
  const allMean = mean(newPlayers.flatMap((b) => b.pts));
  const newPlayerStats = newPlayers.map((b) => ({ label: b.label, n: b.pts.length, mean: Math.round(mean(b.pts) * 10) / 10, median: Math.round(median(b.pts) * 10) / 10, maeIfPredictAll: Math.round(mean(b.pts.map((x) => Math.abs(x - allMean))) * 10) / 10 }));
  console.log('Points by number of earlier matches (all', Math.round(allMean * 10) / 10, 'avg):', newPlayerStats.map((b) => `${b.label}: n=${b.n} mean ${b.mean}`).join(' | '));
  // ---- the two production formulas head to head over EVERY player in the match (including those with few matches) ----
  const prod = { v1: { top11: [] as number[], abs: [] as number[], sp: [] as number[], cap3: [] as number[] }, v2: { top11: [] as number[], abs: [] as number[], sp: [] as number[], cap3: [] as number[] } };
  let prodMatches = 0, prodPlayers = 0;
  for (const [, mrows] of matches) {
    const day = mrows[0].played_on;
    const pl = mrows.map((r) => {
      const all = (by.get(`${r.gender}|${r.player}`) ?? []).filter((h) => h.played_on < day).map((h) => h.points).reverse();
      return { act: r.points, all };
    });
    if (pl.length < 14) continue;
    const NONE = 40; // players with no history at all get the same neutral guess under both formulas
    const f1 = (all: number[]) => { if (!all.length) return NONE; const rec = all.slice(0, 10); return blendBaseLegacy({ n_all: all.length, mean_all: mean(all), n_recent: rec.length, mean_recent: mean(rec) })?.base ?? NONE; };
    const f2 = (all: number[]) => { if (!all.length) return NONE; return blendBase({ n_all: all.length, mean_all: mean(all), n_recent: Math.min(all.length, 20), mean_recent: ewmMean(all.slice(0, 20)) })?.base ?? NONE; };
    prodMatches++; prodPlayers += pl.length;
    const act = pl.map((p) => p.act);
    const sortedAct = [...act].sort((a, b) => b - a);
    for (const [id, f] of [['v1', f1], ['v2', f2]] as const) {
      const est = pl.map((p) => f(p.all));
      const order = est.map((x, i) => [x, i] as const).sort((a, b) => b[0] - a[0]);
      prod[id].top11.push(order.slice(0, 11).reduce((t, [, i]) => t + act[i], 0));
      prod[id].abs.push(...est.map((x, i) => Math.abs(x - act[i])));
      const sp = spearman(est, act); if (Number.isFinite(sp)) prod[id].sp.push(sp);
      prod[id].cap3.push(1 + sortedAct.findIndex((x) => x === act[order[0][1]]) <= 3 ? 1 : 0);
    }
  }
  const dTop11 = prod.v2.top11.map((x, i) => x - prod.v1.top11[i]);
  const dSp = prod.v2.sp.map((x, i) => x - prod.v1.sp[i]);
  const production = {
    matches: prodMatches, players: prodPlayers,
    v1: { top11: Math.round(mean(prod.v1.top11) * 10) / 10, mae: Math.round(mean(prod.v1.abs) * 100) / 100, spearman: Math.round(mean(prod.v1.sp) * 1000) / 1000, captainTop3: Math.round(mean(prod.v1.cap3) * 1000) / 10 },
    v2: { top11: Math.round(mean(prod.v2.top11) * 10) / 10, mae: Math.round(mean(prod.v2.abs) * 100) / 100, spearman: Math.round(mean(prod.v2.sp) * 1000) / 1000, captainTop3: Math.round(mean(prod.v2.cap3) * 1000) / 10 },
    top11Diff: Math.round(mean(dTop11) * 10) / 10, top11DiffCi: bootstrapCI(dTop11).map((x) => Math.round(x * 10) / 10),
    spearmanDiff: Math.round(mean(dSp) * 1000) / 1000, spearmanDiffCi: bootstrapCI(dSp).map((x) => Math.round(x * 1000) / 1000),
  };
  console.log(`PRODUCTION v1 vs v2 over every player (${prodMatches} matches, ${prodPlayers} players): top-11 ${production.v1.top11} -> ${production.v2.top11} (diff ${production.top11Diff} [${production.top11DiffCi}]), rank ${production.v1.spearman} -> ${production.v2.spearman} (diff ${production.spearmanDiff} [${production.spearmanDiffCi}]), avg miss ${production.v1.mae} -> ${production.v2.mae}, captain top-3 ${production.v1.captainTop3}% -> ${production.v2.captainTop3}%`);
  const base = perVariant.get('v1')!;
  const capRank: number[][] = Array.from({ length: 8 }, () => []);
  const capAlt = new Map<string, { pts: number[]; top1: number[]; top3: number[] }>(['xp', 'floor', 'ceiling', 'upside'].map((k) => [k, { pts: [], top1: [], top3: [] }]));
  for (const [ref, mrows] of matches) {
    const day = mrows[0].played_on;
    const pl = mrows.map((r) => { const h = (by.get(`${r.gender}|${r.player}`) ?? []).filter((x) => x.played_on < day); const all = h.map((x) => x.points).reverse(); return { r, all, rec: all.slice(0, 10) }; }).filter((p) => ok(p.all, p.rec));
    if (pl.length < 12) continue;
    const ewm = ESTIMATORS.find((e) => e.id === 'ewm')!;
    const est = pl.map((p) => ewm.f(p.all, p.rec, globalPrior) as number);
    const act = pl.map((p) => p.r.points);
    const order = est.map((x, i) => [x, i] as const).sort((a, b) => b[0] - a[0]);
    for (let k = 0; k < 8; k++) capRank[k].push(act[order[k][1]]);
    const sortedAct = [...act].sort((a, b) => b - a);
    const q = (xs: number[], f: number) => { const s2 = [...xs].sort((a, b) => a - b); return s2[Math.min(s2.length - 1, Math.floor(f * s2.length))]; };
    const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(mean(xs.map((x) => (x - m) ** 2))); };
    const scores: Record<string, number[]> = {
      xp: est,
      floor: pl.map((p) => q(p.rec, 0.25)),
      ceiling: pl.map((p) => q(p.rec, 0.75)),
      upside: pl.map((p, i) => est[i] + 0.5 * sd(p.rec)),
    };
    for (const [k, sc] of Object.entries(scores)) {
      const top = sc.map((x, i) => [x, i] as const).sort((a, b) => b[0] - a[0])[0][1];
      const rk = 1 + sortedAct.findIndex((x) => x === act[top]);
      const c = capAlt.get(k)!; c.pts.push(act[top]); c.top1.push(rk === 1 ? 1 : 0); c.top3.push(rk <= 3 ? 1 : 0);
    }
  }

  const n = matchOrder.length;
  const table = ESTIMATORS.map((e) => {
    const v = perVariant.get(e.id)!;
    const dTop = v.top11.map((x, i) => x - base.top11[i]);
    const dSp = v.sp.map((x, i) => x - base.sp[i]);
    const dAbs = base.abs.map((x, i) => x - v.abs[i]); // positive = this variant has a smaller miss than v1
    return {
      id: e.id, label: e.label,
      mae: Math.round(mean(v.abs) * 100) / 100,
      bias: Math.round(mean(v.bias) * 100) / 100,
      spearman: Math.round(mean(v.sp) * 1000) / 1000,
      top11: Math.round(mean(v.top11) * 10) / 10,
      captainTop3: Math.round(mean(v.cap3) * 1000) / 10,
      captainPts: Math.round(mean(v.capPts) * 10) / 10,
      vsV1: { top11: Math.round(mean(dTop) * 10) / 10, top11Ci: bootstrapCI(dTop).map((x) => Math.round(x * 10) / 10), spearman: Math.round(mean(dSp) * 1000) / 1000, spearmanCi: bootstrapCI(dSp).map((x) => Math.round(x * 1000) / 1000), maeGain: Math.round(mean(dAbs) * 100) / 100, maeGainCi: bootstrapCI(dAbs).map((x) => Math.round(x * 100) / 100) },
    };
  });
  const out = {
    generatedAt: new Date().toISOString(), from, matches: n, playerRows: perVariant.get('v1')!.abs.length,
    oracleTop11: Math.round(mean(oracle) * 10) / 10,
    roleAverages: Object.fromEntries([...prior].map(([k, v]) => [k, Math.round(v * 10) / 10])),
    biasByRole: Object.fromEntries([...groupBias].map(([id, m]) => [id, [...m].map(([g, v]) => ({ role: g, n: v.length, bias: Math.round(mean(v) * 10) / 10 }))])),
    table,
    production, newPlayerStats, smallTest, smallN: small.length, allMean: Math.round(allMean * 10) / 10,
    captainByRank: capRank.map((v, i) => ({ rank: i + 1, avgActual: Math.round(mean(v) * 10) / 10 })),
    captainScores: [...capAlt].map(([k, c]) => ({ score: k, avgActual: Math.round(mean(c.pts) * 10) / 10, top1: Math.round(mean(c.top1) * 1000) / 10, top3: Math.round(mean(c.top3) * 1000) / 10 })),
  };
  console.log(`\n${n} matches, ${out.playerRows} player-match predictions. Oracle top-11 = ${out.oracleTop11}`);
  for (const t of table) console.log(`${t.id.padEnd(14)} MAE ${String(t.mae).padEnd(6)} bias ${String(t.bias).padStart(6)} | rank ${t.spearman} | top-11 ${t.top11} (vs v1 ${t.vsV1.top11 >= 0 ? '+' : ''}${t.vsV1.top11} [${t.vsV1.top11Ci}]) | captain top-3 ${t.captainTop3}%`);
  console.log('\nAverage points of the player ranked k-th by our estimate (captain candidates):', out.captainByRank.map((c) => `#${c.rank}: ${c.avgActual}`).join('  '));
  console.log('Captain by score:', out.captainScores.map((c) => `${c.score}: avg ${c.avgActual}, best-of-match ${c.top1}%, top-3 ${c.top3}%`).join(' | '));
  if (save) await sb.from('api_cache').upsert({ key: storeKey, payload: out, fetched_at: new Date().toISOString(), ttl_seconds: 3650 * 86400 });
  console.log(save ? `\nsaved to ${storeKey}` : '\n(not saved: --nosave)');
}
main().catch((e) => { console.error(e.message ?? e); process.exit(1); });
