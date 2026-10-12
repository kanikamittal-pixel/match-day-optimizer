'use client';
import { useEffect, useState } from 'react';
import { api } from '@/frontend/api';
import { EXPERIENCE_PRIOR, MIN_ALL, SMALL_SAMPLE_WEIGHT } from '@/shared/form';

/** The decision rubric in plain tables. Limits and scoring values are read live, so this page can never drift from the app. */
export default function Rubric() {
  const [rules, setRules] = useState<any>(null);
  const [w, setW] = useState<any>(null);
  useEffect(() => {
    api('/api/settings/rules').then((r) => setRules(r.rules)).catch(() => {});
    api('/api/settings/weights').then((r) => setW(r.versions.find((v: any) => v.active))).catch(() => {});
  }, []);
  if (!rules || !w) return <div className="skel" style={{ height: 260, marginTop: 14 }} />;
  const ws = w.weights;
  const prior = (lo: number) => EXPERIENCE_PRIOR.find((p) => p.lo === lo)?.mean;

  return (
    <>
      <p className="sub" style={{ marginTop: 6 }}>Exactly how a player gets chosen, with the weight of every factor. Numbers on this page are read from the live settings.</p>

      <h2>1. How each player's expected points are built</h2>
      <div className="card flat" style={{ overflowX: 'auto' }}>
        <table className="t rb">
          <thead><tr><th>Step</th><th>Weight / rule</th><th>Where it comes from</th></tr></thead>
          <tbody>
            <tr><td><b>Career average</b></td><td><b>50%</b> of the base (for players with {MIN_ALL}+ earlier T20 matches)</td><td>Cricsheet ball-by-ball data, scored with Dream11's T20 table: internationals and the major leagues since 2018</td></tr>
            <tr><td><b>Recent form</b></td><td><b>50%</b> of the base: a recency-weighted average of the last 20 matches. Each match counts half as much as the one five matches newer</td><td>Same data. (Tested on 1,236 matches: better than a flat last-10 average, a small gain.)</td></tr>
            <tr><td><b>Players with 1 to 4 earlier matches</b></td><td>(matches × own average + {SMALL_SAMPLE_WEIGHT} × typical score) ÷ (matches + {SMALL_SAMPLE_WEIGHT}); typical score {prior(1)} for 1-2 matches, {prior(3)} for 3-4</td><td>Typical scores measured over 6,000+ player-matches</td></tr>
            <tr><td><b>No history found</b></td><td>The base is skipped and Gemini gives its own estimate. The team card lists these players</td><td>Gemini</td></tr>
            <tr><td><b>Match conditions</b></td><td>Gemini adds or subtracts points, capped at the larger of 10 points or 40% of the base. It weighs: pitch and venue record, weather and dew, the opposition, expected batting position, role in this XI, team news, Aryan's playbook rules and past error patterns</td><td>Gemini with Google Search (sources shown)</td></tr>
            <tr><td><b>League type</b></td><td>No effect on the numbers (a test found no benefit from a different captain for small and grand leagues)</td><td>Back-tests</td></tr>
          </tbody>
        </table>
      </div>

      <h2>2. How the XI and captains are chosen</h2>
      <div className="card flat" style={{ overflowX: 'auto' }}>
        <table className="t rb">
          <thead><tr><th>Rule</th><th>Value</th><th>Decided by</th></tr></thead>
          <tbody>
            <tr><td><b>Who is eligible</b></td><td>The announced or probable XI, plus impact substitutes</td><td>You, via the squad table</td></tr>
            <tr><td><b>Team size</b></td><td>{rules?.team_size ?? 11} players</td><td>Code</td></tr>
            <tr><td><b>Players per role</b></td><td>{rules ? `WK ${rules.role_min.WK}-${rules.role_max.WK} · BAT ${rules.role_min.BAT}-${rules.role_max.BAT} · AR ${rules.role_min.AR}-${rules.role_max.AR} · BOWL ${rules.role_min.BOWL}-${rules.role_max.BOWL}` : '…'}</td><td>Code (editable in Settings)</td></tr>
            <tr><td><b>From one real team</b></td><td>At most {rules?.max_per_team ?? 7}</td><td>Code (editable in Settings)</td></tr>
            <tr><td><b>Credits</b></td><td>{rules?.credit_cap ?? 100}-credit cap, applied only when every player's credit is known</td><td>Code</td></tr>
            <tr><td><b>Which 11</b></td><td>The valid team with the highest total expected points (an exact search, not a guess)</td><td>Code, no AI</td></tr>
            <tr><td><b>Captain</b></td><td>{rules?.captain_mult ?? 2}× points. Gemini picks, but code keeps the captain within the top 3 by expected points</td><td>Gemini, checked by code</td></tr>
            <tr><td><b>Vice-captain</b></td><td>{rules?.vc_mult ?? 1.5}× points. Within the top 4 by expected points</td><td>Gemini, checked by code</td></tr>
            <tr><td><b>The final say</b></td><td>Every swap, captain change or lock is yours. The agent states its case once and never blocks you. Your choices are tagged gut or reasoned</td><td>Aryan</td></tr>
          </tbody>
        </table>
      </div>

      <h2>3. Dream11 points the expected points are measured in {w ? `(scoring version ${w.version})` : ''}</h2>
      <div className="card flat" style={{ overflowX: 'auto' }}>
        <table className="t rb">
          <thead><tr><th>Event</th><th className="r">Points</th><th>Event</th><th className="r">Points</th></tr></thead>
          <tbody>
            {[
              ['Run', ws.run, 'Wicket (not run-out)', ws.wicket],
              ['Boundary bonus', ws.boundary_bonus, 'LBW / bowled bonus', ws.lbw_bowled_bonus],
              ['Six bonus', ws.six_bonus, '3 / 4 / 5 wickets', `${ws.bonus_3_wkts} / ${ws.bonus_4_wkts} / ${ws.bonus_5_wkts}`],
              ['25 / 50 / 75 / 100 runs', `${ws.bonus_25} / ${ws.bonus_50} / ${ws.bonus_75} / ${ws.bonus_100}`, 'Dot ball', ws.dot_ball],
              ['Duck (not bowlers)', ws.duck, 'Maiden over', ws.maiden],
              ['Playing XI', ws.in_xi, 'Catch / 3-catch bonus', `${ws.catch} / ${ws.bonus_3_catches}`],
              ['Strike rate >170 / 150-170 / 130-150', `${ws.sr_over_170} / ${ws.sr_150_170} / ${ws.sr_130_150}`, 'Stumping', ws.stumping],
              ['Strike rate 60-70 / 50-60 / <50', `${ws.sr_60_70} / ${ws.sr_50_60} / ${ws.sr_under_50}`, 'Run-out direct / not direct', `${ws.run_out_direct} / ${ws.run_out_indirect}`],
              ['Economy <5 / 5-6 / 6-7', `${ws.econ_under_5} / ${ws.econ_5_6} / ${ws.econ_6_7}`, 'Economy 10-11 / 11-12 / >12', `${ws.econ_10_11} / ${ws.econ_11_12} / ${ws.econ_over_12}`],
            ].map((r, i) => (<tr key={i}><td>{r[0]}</td><td className="r num">{String(r[1] ?? '…')}</td><td>{r[2]}</td><td className="r num">{String(r[3] ?? '…')}</td></tr>))}
          </tbody>
        </table>
      </div>
      <p className="sub">Strike-rate bonuses need 10+ balls, economy bonuses 2+ overs. Checked against Dream11's own points page on 12 Oct 2026.</p>
    </>
  );
}
