'use client';
import { useEffect, useState } from 'react';
import { api } from '@/frontend/api';
import { Banner } from './ui';

export default function DataCheck() {
  const [d, setD] = useState<any>(null);
  const [st, setSt] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/api/insights/backtests').then(setD).catch((e) => setErr(e.message)); api('/api/status').then(setSt).catch(() => {}); }, []);
  if (err) return <Banner kind="bad">{err}</Banner>;
  if (!d) return <div className="skel" style={{ height: 220, marginTop: 14 }} />;
  const a = d.audit?.matches?.[0];
  const latest = st?.history?.latest ? new Date(st.history.latest).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '…';

  return (
    <>
      <h2>How recent form is calculated</h2>
      <div className="card">
        <ol className="bt-notes" style={{ lineHeight: 1.6 }}>
          <li>Every T20 match since 2018 (internationals and the major leagues) is read ball by ball from <b>Cricsheet</b>.</li>
          <li>Each player's performance in each match is scored with Dream11's own T20 points table: runs, boundaries, wickets, dot balls, catches and so on.</li>
          <li>For a match being predicted, only matches played <b>before that day</b> are used, so the future can never leak in.</li>
          <li>A short Dream11 name such as "S Farhan" is linked to the right player only if the surname and first initial match <b>exactly one</b> player of that team's recent squad. If it is ambiguous (two "K Mendis"), the app uses no history rather than the wrong person's.</li>
          <li>"Recent form" is a recency-weighted average of the player's last 20 matches; "career" is the plain average of all of them. The base is half of each.</li>
        </ol>
        <p className="sub" style={{ marginBottom: 0 }}>History runs through <b>{latest}</b>. Cricsheet publishes a few days late; the daily refresh fills the gap from CricketData scorecards (dot balls estimated), then removes those rows once Cricsheet has the same match.</p>
      </div>

      {st?.history?.latest && Date.now() - new Date(st.history.latest).getTime() > 2 * 86400000 && (
        <Banner kind="warn">
          <b>Known gap.</b> The history runs through {latest}, and {st.history.topUpRows ? `${st.history.topUpRows} rows from newer matches have been added from CricketData.` : 'newer matches are not in it yet (for example the Pakistan v Sri Lanka T20Is on 9 and 11 October).'} The daily refresh adds finished T20s from CricketData scorecards until Cricsheet publishes them; it could not run today because CricketData's free daily quota was used up, so it will run at the next refresh.
        </Banner>
      )}

      <h2>Is the data correct? Four independent checks</h2>
      <div className="card flat" style={{ overflowX: 'auto' }}>
        <table className="t rb">
          <thead><tr><th>Check</th><th>What was compared</th><th>Result</th></tr></thead>
          <tbody>
            <tr>
              <td><b>1. A second company's data</b></td>
              <td>The same players in the same match, scored from CricketData's scorecards instead of Cricsheet's ball-by-ball</td>
              <td>{a ? <><b>{a.players} players: average difference {a.mae} points</b>, correlation {a.correlation}, {a.within5}% within 5 points, {a.within10}% within 10. Without my dot-ball estimate the difference was {a.maeWithoutDotEstimate}.</> : 'Not run yet.'}</td>
            </tr>
            <tr><td><b>2. Raw-delivery proof</b></td><td>Runs, balls faced, legal balls, dots, runs conceded and wickets added up from the points table, against the raw deliveries of a real match</td><td><b>Exact match</b> on every total (automated test, runs on every change)</td></tr>
            <tr><td><b>3. Dream11's own page</b></td><td>The scoring table the points are computed with, against Dream11's live T20 points page</td><td><b>Same values</b> (fetched 12 Oct 2026)</td></tr>
            <tr><td><b>4. Published Dream11 totals</b></td><td>A public project (Predict-11) reports its scorer matched 40 of 40 published IPL 2026 season totals</td><td>Reported by them. <b>I have not verified this myself.</b></td></tr>
          </tbody>
        </table>
      </div>

      {a && (
        <>
          <h2>Check 1 in detail: {a.title}</h2>
          <div className="card flat" style={{ overflowX: 'auto' }}>
            <table className="t">
              <thead><tr><th>Player</th><th className="r">Cricsheet</th><th className="r">CricketData</th><th className="r">Difference</th></tr></thead>
              <tbody>
                {a.rows.map((r: any) => (
                  <tr key={r.player}><td>{r.player}</td><td className="r num">{r.cricsheet}</td><td className="r num">{r.cricketdata}</td><td className="r num" style={{ color: Math.abs(r.diff) > 5 ? 'var(--amber)' : undefined }}>{r.diff > 0 ? '+' : ''}{r.diff}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="sub">{a.unmatched?.length ? `Not compared (name could not be paired): ${a.unmatched.join(', ')}. ` : ''}Small differences are expected: CricketData has no dot balls (estimated from runs and balls) and cannot tell a direct-hit run-out from an assisted one.</p>
        </>
      )}

      <h2>Honest limits</h2>
      <div className="card">
        <ul className="bt-notes" style={{ lineHeight: 1.6 }}>
          <li>The second-source comparison covers <b>one match</b> so far, because CricketData's free tier is capped at 100 calls a day and was used up. The same script adds more matches as the quota allows.</li>
          <li>Points are computed from the scorecard, so they are very close to, but not exactly, Dream11's own totals. There is no public Dream11 points feed to compare with.</li>
          <li>Cricsheet gives no player roles; for duck and strike-rate exemptions a player who bowls and bats at 8 or lower is treated as a bowler.</li>
          <li>Cricsheet stores names as text, so two different players with the identical written name could be merged. Unlikely, not impossible.</li>
          <li>Matches Cricsheet does not cover (some domestic sides) have no history; the app says so on the team card.</li>
        </ul>
      </div>
    </>
  );
}
