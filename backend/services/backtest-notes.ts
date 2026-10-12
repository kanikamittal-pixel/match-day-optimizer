/**
 * The written record of what the back-tests found and what was done about it. Every number comes from the stored results
 * (the 1,236-match comparison and the saved match back-tests), so the page cannot drift from the data.
 */
export interface Change {
  status: 'adopted' | 'not adopted' | 'finding';
  title: string;
  why: string; // the evidence
  how: string; // what changed (or why nothing did)
}

const sign = (n: number, d = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(d)}`;

export function buildChanges(f: any, records: any[], stability: { key: string; payload: any }[] = []): Change[] {
  const t = (id: string) => f.table.find((x: any) => x.id === id);
  const v1 = t('v1'), ewm = t('ewm'), med = t('median'), rob = t('robust'), shr = t('shrunk'), rec = t('recent'), l5 = t('last5'), car = t('career');
  const cap = f.captainByRank as { rank: number; avgActual: number }[];
  const cs = Object.fromEntries((f.captainScores as any[]).map((c) => [c.score, c]));
  const np = f.newPlayerStats as { label: string; n: number; mean: number }[];
  const small = f.smallTest as { method: string; mae: number }[];
  const v1recs = records.filter((r) => r.logic === 'v1');
  const bowlBias = v1recs.map((r) => r.byRole?.find((g: any) => g.key === 'BOWL')?.bias).filter((x) => typeof x === 'number');
  const out: Change[] = [];
  const period = (k: string) => stability.find((x) => x.key.endsWith(k))?.payload;
  const per = (p: any, id: string) => p?.table?.find((x: any) => x.id === id);
  const h1 = period('jan-may'), h2 = period('jun-oct');
  const ewmStab = h1 && h2
    ? ` Checked separately: January to May ${sign(per(h1, 'ewm').vsV1.top11)} points per match (95% range ${sign(per(h1, 'ewm').vsV1.top11Ci[0])} to ${sign(per(h1, 'ewm').vsV1.top11Ci[1])}), June to October ${sign(per(h2, 'ewm').vsV1.top11)} (range ${sign(per(h2, 'ewm').vsV1.top11Ci[0])} to ${sign(per(h2, 'ewm').vsV1.top11Ci[1])}). It points the same way in both halves but is only clearly above zero in the first, and I tested nine variants, so one looking good by chance is possible. Treat it as a small, tentative gain.`
    : '';
  const medStab = h1 && h2 ? ` It was worse in both halves of the year (${sign(per(h1, 'median').vsV1.top11)} and ${sign(per(h2, 'median').vsV1.top11)}).` : '';
  const careerStab = h1 && h2 ? ` "Career only" swung from ${sign(per(h1, 'career').vsV1.top11)} in January to May to ${sign(per(h2, 'career').vsV1.top11)} in June to October, so it is not reliably better.` : '';

  const pr = f.production;
  if (pr) {
    const p1 = h1?.production, p2 = h2?.production;
    out.push({
      status: 'adopted',
      title: 'Decision: keep the new logic (version 2), tested the way the app really uses it',
      why: `Both versions were run head to head over every player in ${pr.matches.toLocaleString()} matches (${pr.players.toLocaleString()} players, including those with few matches), each using only earlier data. A team picked from version 2's numbers scores ${sign(pr.top11Diff)} points per match more (95% range ${sign(pr.top11DiffCi[0])} to ${sign(pr.top11DiffCi[1])}); the player ranking improves from ${pr.v1.spearman} to ${pr.v2.spearman} (${sign(pr.spearmanDiff, 3)}, range ${sign(pr.spearmanDiffCi[0], 3)} to ${sign(pr.spearmanDiffCi[1], 3)}); the average miss falls from ${pr.v1.mae} to ${pr.v2.mae}.${p1 && p2 ? ` It holds in both halves of the year: January to May ${sign(p1.top11Diff)} (range ${sign(p1.top11DiffCi[0])} to ${sign(p1.top11DiffCi[1])}), June to October ${sign(p2.top11Diff)} (range ${sign(p2.top11DiffCi[0])} to ${sign(p2.top11DiffCi[1])}).` : ''} Captain hit-rate was unchanged (${pr.v1.captainTop3}% to ${pr.v2.captainTop3}% in the top 3).`,
      how: 'Version 2 is the live logic: recency-weighted recent form, a steadier base for players with 1 to 4 matches, and the captain safety net. This is the test that decides it. The three single matches below are not (see the finding about them).',
    });
  }
  out.push({
    status: 'adopted',
    title: 'Recent form now counts recent matches more',
    why: `Over ${f.matches.toLocaleString()} matches (${f.playerRows.toLocaleString()} player predictions, each using only earlier data), weighting the last 20 matches by recency picked better teams than a flat last-10 average: ${sign(ewm.vsV1.top11)} points per match (95% range ${sign(ewm.vsV1.top11Ci[0])} to ${sign(ewm.vsV1.top11Ci[1])}) and a slightly better player ranking (${v1.spearman} to ${ewm.spearman}).${ewmStab}`,
    how: `The "recent" half of the base is now a recency-weighted average (each match counts half as much as the one five matches newer). The career half and the 50/50 split are unchanged.`,
  });
  out.push({
    status: 'adopted',
    title: 'Players with very few matches get a steadier base',
    why: `Players with 1 to 4 earlier matches: their own average missed by ${small.find((s) => s.method.startsWith('player'))?.mae} points, the typical new-player score by ${small.find((s) => s.method.startsWith('typical'))?.mae}, and a 2-to-1 mix of the two by only ${small.find((s) => s.method.includes('2-to-1'))?.mae} (${f.smallN.toLocaleString()} cases). New players average ${np[0].mean} on their first appearance against ${np[np.length - 1].mean} for players with 20+ matches.`,
    how: `With 1 to 4 earlier matches the base is now (matches × own average + 2 × typical score) / (matches + 2), where the typical score is ${np[1].mean} for 1-2 matches and ${np[2].mean} for 3-4. With 5 or more matches nothing changes.`,
  });
  out.push({
    status: 'adopted',
    title: 'Captain safety net',
    why: `The player we rank #1 scored ${cap[0].avgActual} on average, #2 ${cap[1].avgActual}, #3 ${cap[2].avgActual}, #4 ${cap[3].avgActual}, #5 ${cap[4].avgActual}. Picking a lower-ranked captain costs real points (the gap from #1 to #4 is ${(cap[0].avgActual - cap[3].avgActual).toFixed(1)} points, doubled for a captain). In the three matches tested our captain was already the #1 player by our own estimate, so this rule changed nothing there.`,
    how: `Gemini still chooses the captain and vice-captain, but code now keeps the captain inside the top 3 by expected points and the vice-captain inside the top 4, and says so on the team card when it steps in.`,
  });
  out.push({
    status: 'not adopted',
    title: 'Using medians or "robust" averages',
    why: `It looked right after the three matches (bowlers were over-predicted), and medians do give a smaller average miss (${med.mae} against ${v1.mae}). But they pick worse teams: ${sign(med.vsV1.top11)} points per match (95% range ${sign(med.vsV1.top11Ci[0])} to ${sign(med.vsV1.top11Ci[1])}). Fantasy scores are lopsided (a few big hauls), and a team's total is made of averages, not medians. The half-mean-half-median blend was also worse (${sign(rob.vsV1.top11)}).${medStab}`,
    how: 'No change. The mean stays the target.',
  });
  out.push({
    status: 'not adopted',
    title: 'Pulling every player toward their role average',
    why: `Gain of ${sign(shr.vsV1.top11)} points per match, range ${sign(shr.vsV1.top11Ci[0])} to ${sign(shr.vsV1.top11Ci[1])}: not distinguishable from zero for players with 5 or more matches.`,
    how: 'No change for experienced players (the small-sample mix above covers the cases where it does help).',
  });
  out.push({
    status: 'not adopted',
    title: 'Dropping one half of the blend',
    why: `Recent form alone is clearly worse (${sign(rec.vsV1.top11)} points per match), and the last 5 matches alone worse still (${sign(l5.vsV1.top11)}). Career alone is about the same as the blend (${sign(car.vsV1.top11)}, range ${sign(car.vsV1.top11Ci[0])} to ${sign(car.vsV1.top11Ci[1])}), so keeping both halves costs nothing.${careerStab}`,
    how: 'The 50/50 split stays.',
  });
  out.push({
    status: 'not adopted',
    title: 'Different captains for small and grand leagues',
    why: `Choosing the captain by "safe floor" (${cs.floor.avgActual} average points) or "high ceiling" (${cs.ceiling.avgActual}) did not beat plain expected points (${cs.xp.avgActual}); an "upside" score matched it (${cs.upside.avgActual}).`,
    how: 'No change. There is no evidence that the league type should change who captains the team, so it is treated as a tie-break only.',
  });
  if (bowlBias.length) {
    out.push({
      status: 'finding',
      title: 'Bowlers were over-predicted in the tested matches, but it is not a systematic bias',
      why: `In the ${bowlBias.length} matches tested our bowlers were predicted ${bowlBias.map((b: number) => sign(b)).join(', ')} points too high on average. Across all ${f.playerRows.toLocaleString()} predictions, bowler-like players were over-predicted by only ${sign(f.biasByRole.v1.find((g: any) => g.role === 'bowler-like')?.bias ?? 0)} points. Picking the highest-ranked players tends to pick the ones whose estimates happened to be too high, and on those match days runs flowed freely.`,
      how: 'No change to the numbers. This is match-day variance plus the "pick the top of the list" effect, not something a formula fix can remove.',
    });
  }
  const v2recs = records.filter((r) => r.logic === 'v2');
  if (v1recs.length && v2recs.length) {
    const sumOf = (rs: any[]) => rs.reduce((t, r) => t + r.metrics.agent, 0);
    const fc = v2recs.filter((r) => r.formulaCheck);
    out.push({
      status: 'finding',
      title: 'The three matches do not show the change helping, and that is expected',
      why: `Re-running the same three matches with the new logic (same players and roles): our team scored ${Math.round(sumOf(v2recs))} in total against ${Math.round(sumOf(v1recs))} before. ${fc.length ? `With Gemini switched out of the picture, a team picked from the old base scored ${fc.reduce((t, r) => t + r.formulaCheck.v1.points, 0)} in total and from the new base ${fc.reduce((t, r) => t + r.formulaCheck.v2.points, 0)}. ` : ''}A single match's team total swings by 100 points or more from luck alone, and Gemini's pitch adjustments differ a little on every run, so three matches cannot show an effect worth a few points per match.`,
      how: `The check that counts is the ${f.matches.toLocaleString()}-match test. I am keeping the new logic because of that test, not because of these three matches, and Insights will keep measuring it against a plain last-5 average as your own results come in.`,
    });
  }
  out.push({
    status: 'finding',
    title: 'How good can any method be?',
    why: `Even a perfect knowledge of the best 11 players in hindsight is out of reach: across the ${f.matches.toLocaleString()} matches the best possible top 11 averages ${f.oracleTop11} points, and our history-based method gets ${v1.top11} (${Math.round((v1.top11 / f.oracleTop11) * 100)}%). Single-match fantasy scores are mostly luck, so expect misses.`,
    how: 'The goal is a small, steady edge over a plain last-5 average, which Insights keeps measuring.',
  });
  return out;
}
