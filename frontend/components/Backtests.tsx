'use client';
import { useEffect, useState } from 'react';
import { api } from '@/frontend/api';
import { Banner } from './ui';

type Rec = any;
const pctW = (v: number, max: number) => `${Math.max(2, Math.round((v / max) * 100))}%`;

function Bars({ rec }: { rec: Rec }) {
  const m = rec.metrics;
  const max = Math.max(m.agent, m.baseline, m.hindsight);
  const row = (label: string, v: number, cls: string) => (
    <div className="bt-bar"><span className="bt-l">{label}</span><div className="bt-track"><div className={`bt-fill ${cls}`} style={{ width: pctW(v, max) }} /></div><b className="num">{v}</b></div>
  );
  return <div>{row('Our team', m.agent, 'us')}{row('Last-5 average', m.baseline, 'base')}{row('Best possible', m.hindsight, 'best')}</div>;
}

function MatchCard({ versions }: { versions: Rec[] }) {
  const cur = versions[0];
  const old = versions.find((v) => v.logic !== cur.logic);
  const m = cur.metrics;
  const [open, setOpen] = useState(false);
  const sev = (s: string) => (s === 'bad' ? 'bad' : s === 'warn' ? 'warn' : 'ok');
  return (
    <div className="card bt-card">
      <div className="row sb" style={{ alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{cur.title}</div>
          <div className="sub">{new Date(cur.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })} · {cur.event}</div>
        </div>
        <span className="pill">{m.agentPctOfHindsight}% of best</span>
      </div>
      <div style={{ margin: '12px 0 8px' }}><Bars rec={cur} /></div>
      <div className="sub">Captain <b style={{ color: 'var(--text)' }}>{cur.agent.captain}</b> scored {m.captainActual}, #{m.captainRank} of {cur.players.length}. Average miss per player: ours {m.maeAgent}{m.maeBaseline !== null ? ` vs ${m.maeBaseline} for the last-5 average` : ''}.</div>

      {old && (
        <table className="t" style={{ marginTop: 10 }}>
          <thead><tr><th>Same match, other logic</th><th className="r">Our team</th><th className="r">Avg miss</th><th className="r">Captain</th></tr></thead>
          <tbody>
            {[old, cur].map((r) => (
              <tr key={r.logic}><td>{r.logic === cur.logic ? `After (${r.logic})` : `Before (${r.logic})`}</td><td className="r num">{r.metrics.agent}</td><td className="r num">{r.metrics.maeAgent}</td><td className="r num">#{r.metrics.captainRank}</td></tr>
            ))}
          </tbody>
        </table>
      )}
      <button className="btn sm ghost" style={{ marginTop: 10 }} onClick={() => setOpen(!open)}>{open ? 'Hide the post-mortem' : 'Show where it went wrong'}</button>
      {open && (
        <div style={{ marginTop: 10 }}>
          <h3 className="bt-h">What went wrong ({cur.logic} logic)</h3>
          {cur.findings.map((f: any, i: number) => (<div key={i} className={`bt-find ${sev(f.severity)}`}>{f.text}</div>))}
          <h3 className="bt-h">Player by player</h3>
          <div style={{ overflowX: 'auto' }}>
            <table className="t bt-players">
              <thead><tr><th>Player</th><th>Role</th><th className="r">Expected</th><th className="r">Base</th><th className="r">Actual</th><th className="r">Miss</th><th>In</th></tr></thead>
              <tbody>
                {cur.players.map((p: any) => {
                  const miss = Math.round((p.predicted - p.actual) * 10) / 10;
                  return (
                    <tr key={p.name} className={p.inAgentXI ? 'mine' : ''}>
                      <td>{p.name}<div className="sub">{p.team}{p.batPos ? ` · batted ${p.batPos}` : ''}</div></td><td>{p.role}</td>
                      <td className="r num">{p.predicted}</td><td className="r num">{p.base ?? '–'}</td><td className="r num"><b>{p.actual}</b></td>
                      <td className="r num" style={{ color: Math.abs(miss) >= 40 ? 'var(--red)' : undefined }}>{miss > 0 ? '+' : ''}{miss}</td>
                      <td>{p.inAgentXI ? '✔' : ''}{p.inHindsightXI ? ' ★' : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="sub">✔ in our team · ★ in the best possible team · Miss = expected minus actual (positive means we were too high).</p>
          {cur.formulaCheck && (
        <div className="bt-check">
          <b>Formula check, no Gemini, same players and roles:</b> a team built only from the old base scored <b className="num">{cur.formulaCheck.v1.points}</b> (average miss {cur.formulaCheck.v1.mae}); from the new base <b className="num">{cur.formulaCheck.v2.points}</b> (average miss {cur.formulaCheck.v2.mae}). With one match this is only an illustration: Gemini's own variation between two runs is bigger than the effect of the formula.
        </div>
      )}
          {old && <p className="sub" style={{ margin: '6px 0 0' }}>This match was used to find the problems, so treat the “after” as a sanity check, not as proof. The proof is the large test below.</p>}

          <h3 className="bt-h">How this was kept honest</h3>
          <ul className="bt-notes">{cur.notes.map((n: string, i: number) => <li key={i}>{n}</li>)}<li>“Actual” points are computed from the ball-by-ball scorecard with the Dream11 T20 table, so they are close to, but not exactly, Dream11’s own totals.</li></ul>
        </div>
      )}
    </div>
  );
}

export default function Backtests() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/api/insights/backtests').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <Banner kind="bad">{err}</Banner>;
  if (!d) return <div className="skel" style={{ height: 220, marginTop: 14 }} />;
  if (!d.matches.length) return <Banner>No back-tests yet. Run <code>npm run backtest -- &lt;match id&gt;</code> to build a team for a finished match and score it.</Banner>;

  const latest = d.matches.map((v: Rec[]) => v[0]);
  const avgPct = Math.round(latest.reduce((s: number, r: Rec) => s + r.metrics.agentPctOfHindsight, 0) / latest.length);
  const beats = latest.filter((r: Rec) => r.metrics.agent > r.metrics.baseline).length;
  const f = d.formulas;
  const checks = latest.filter((r: Rec) => r.formulaCheck);
  const sum = (k: 'v1' | 'v2') => checks.reduce((t: number, r: Rec) => t + r.formulaCheck[k].points, 0);
  const status = (s: string) => (s === 'adopted' ? 'ok' : s === 'not adopted' ? '' : 'warn');

  return (
    <>
      <p className="sub" style={{ marginTop: 6 }}>We replay finished matches using only what was known <b>before</b> each one, then compare with what happened.</p>
      <div className="tiles" style={{ marginTop: 10 }}>
        <div className="tile"><div className="k">Matches tested</div><div className="v num">{latest.length}</div><div className="s">finished matches, last 6 days</div></div>
        <div className="tile"><div className="k">Share of best possible</div><div className="v num">{avgPct}%</div><div className="s">average of our team vs the best team in hindsight</div></div>
        <div className="tile"><div className="k">Beat last-5 average</div><div className="v num">{beats}/{latest.length}</div><div className="s">our team vs a plain recent-form team</div></div>
        <div className="tile"><div className="k">Large test</div><div className="v num">{f ? f.matches.toLocaleString() : '–'}</div><div className="s">matches used to check the fixes</div></div>
      </div>

      <details className="card fold">
        <summary>How the analysis works</summary>
        <ol className="bt-notes" style={{ lineHeight: 1.65 }}>
          <li><b>Pick a finished match</b> and rebuild the situation before the toss: the real XI (public at the toss), each player's history from <b>earlier matches only</b>, and no web search at all, so nothing about the result can leak in.</li>
          <li><b>Run the exact production logic</b>: the history base, Gemini's conditions adjustment, the exact search for the best valid XI, and the captain choice.</li>
          <li><b>Only then read what happened</b>: every player's actual Dream11 points, computed ball by ball.</li>
          <li><b>Compare three teams</b>: ours, a plain "average of each player's last 5 matches" team, and the best possible team in hindsight.</li>
          <li><b>Post-mortem</b>: automatic checks list the biggest wrong picks, the stars we left out, where the captain finished, whether Gemini's adjustment helped or hurt, how players with no history did, and any bias by role or batting position.</li>
          <li><b>Test every fix on many more matches</b>: an idea only counts if it holds across {f ? f.matches.toLocaleString() : 'about 1,200'} past matches (no AI involved, only earlier data for each match), with a 95% confidence range, and then in two separate halves of the year.</li>
        </ol>
        <p className="sub" style={{ marginBottom: 0 }}>Reading the numbers: team points include the captain's 2× and vice-captain's 1.5×. “Best possible” is the highest-scoring valid XI chosen with perfect hindsight, so nothing can reach 100%. One match is mostly luck; patterns only matter when they repeat.</p>
      </details>

      <h2>Matches already played</h2>
      {d.matches.map((versions: Rec[]) => <MatchCard key={versions[0].ref} versions={versions} />)}

      {(() => {
        const roles = ['WK', 'BAT', 'AR', 'BOWL'];
        const cell = (r: Rec, role: string) => r.byRole.find((g: any) => g.key === role);
        return (
          <>
            <h2>Patterns across these matches</h2>
            <p className="sub" style={{ marginTop: 0 }}>Points we guessed too high (+) or too low (−) per player, by role.</p>
            <div className="card flat" style={{ overflowX: 'auto' }}>
              <table className="t">
                <thead><tr><th>Role</th>{latest.map((r: Rec) => <th key={r.ref} className="r">{r.title.replace(' v ', ' v ')}</th>)}<th>Reads as</th></tr></thead>
                <tbody>
                  {roles.map((role) => {
                    const vals = latest.map((r: Rec) => cell(r, role)?.bias as number | undefined);
                    const nums = vals.filter((x: number | undefined): x is number => typeof x === 'number');
                    const same = nums.length >= 2 && (nums.every((x: number) => x > 3) || nums.every((x: number) => x < -3));
                    return (
                      <tr key={role}><td><b>{role}</b></td>
                        {vals.map((v: number | undefined, i: number) => <td key={i} className="r num" style={{ color: typeof v === 'number' && Math.abs(v) >= 15 ? (v > 0 ? 'var(--red)' : 'var(--amber)') : undefined }}>{typeof v === 'number' ? `${v > 0 ? '+' : ''}${v}` : '–'}</td>)}
                        <td>{same ? <span className="pill warn">same direction every time</span> : <span className="sub">mixed</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <details className="fold-sm"><summary>Why bowlers are over-predicted</summary><p className="sub">Bowlers were over-predicted in all three matches, so I checked it against {f ? f.playerRows.toLocaleString() : 'thousands of'} predictions. Across all of them the bias for bowler-like players is only {f?.biasByRole?.v1?.find((g: any) => g.role === 'bowler-like')?.bias ?? '…'} points, so it is match-day luck plus the "pick the top of the list" effect, not a flaw to patch (see below).</p></details>
          </>
        );
      })()}

      {d.changes.length > 0 && (
        <>
          <h2>What I changed, and why</h2>
          {d.changes.map((c: any) => (
            <div key={c.title} className="card change">
              <div className="row sb" style={{ alignItems: 'flex-start', gap: 10 }}><b>{c.title}</b><span className={`pill ${status(c.status)}`}>{c.status}</span></div>
              <details className="fold-sm"><summary>Evidence and what changed</summary><div className="ch-k">The evidence</div><div>{c.why}</div><div className="ch-k">What changed</div><div>{c.how}</div></details>
            </div>
          ))}
        </>
      )}

      {f && (
        <>
          <h2>Every method I tried ({f.matches.toLocaleString()} matches)</h2>
          <details className="fold-sm"><summary>How to read this table</summary><p className="sub">Each prediction used only matches played before that day. “Top-11 points” is what the 11 highest-ranked players actually scored (the best possible is {f.oracleTop11}). The ± range is a 95% confidence range: if it includes 0, the difference could be luck.</p></details>
          <div className="card flat" style={{ overflowX: 'auto' }}>
            <table className="t">
              <thead><tr><th>Method</th><th className="r">Avg miss</th><th className="r">Top-11 points</th><th className="r">vs current</th></tr></thead>
              <tbody>
                {f.table.map((t: any) => (
                  <tr key={t.id}>
                    <td>{t.label}</td><td className="r num">{t.mae}</td><td className="r num">{t.top11}</td>
                    <td className="r num" style={{ color: t.id === 'v1' ? undefined : t.vsV1.top11Ci[0] > 0 ? 'var(--good)' : t.vsV1.top11Ci[1] < 0 ? 'var(--red)' : 'var(--mute)' }}>
                      {t.id === 'v1' ? 'baseline' : `${t.vsV1.top11 >= 0 ? '+' : ''}${t.vsV1.top11} (${t.vsV1.top11Ci[0]} to ${t.vsV1.top11Ci[1]})`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ gap: 10, marginTop: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
            <div className="card grow" style={{ minWidth: 260 }}>
              <b>Captain: what the k-th ranked player scores</b>
              {f.captainByRank.slice(0, 6).map((c: any) => (<div key={c.rank} className="bt-bar"><span className="bt-l">#{c.rank} by our estimate</span><div className="bt-track"><div className="bt-fill us" style={{ width: pctW(c.avgActual, f.captainByRank[0].avgActual) }} /></div><b className="num">{c.avgActual}</b></div>))}
            </div>
            <div className="card grow" style={{ minWidth: 260 }}>
              <b>Points by experience</b>
              {f.newPlayerStats.map((c: any) => (<div key={c.label} className="bt-bar"><span className="bt-l">{c.label}</span><div className="bt-track"><div className="bt-fill base" style={{ width: pctW(c.mean, 60) }} /></div><b className="num">{c.mean}</b></div>))}
              <div className="sub" style={{ marginTop: 6 }}>average points per match by how many earlier matches the player had</div>
            </div>
          </div>
        </>
      )}
    </>
  );
}
