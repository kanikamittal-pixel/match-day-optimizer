'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/frontend/api';
import { Banner, short } from '@/frontend/components/ui';

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const sign = (n: number) => (n > 0 ? `+${n}` : `${n}`);

function Tile({ k, v, s, tone }: { k: string; v: string; s?: string; tone?: 'good' | 'bad' }) {
  return <div className="rp-tile"><div className="k">{k}</div><div className="v num" style={{ color: tone === 'good' ? 'var(--good)' : tone === 'bad' ? 'var(--red)' : undefined }}>{v}</div>{s && <div className="s">{s}</div>}</div>;
}

function TeamTable({ title, rows, mark }: { title: string; rows: any[]; mark: 'inTop11' | 'inOurXI' }) {
  return (
    <div className="rp-col">
      <div className="pf-label">{title}</div>
      <table className="t"><tbody>
        {rows.map((p) => (
          <tr key={p.name} className={p[mark] ? 'pf-picked' : p.played ? '' : 'pf-out'}>
            <td>{p[mark] ? '✓ ' : ''}{p.name}{p.badge === 'C' && <b className="badge-c">C</b>}{p.badge === 'VC' && <b className="badge-vc">VC</b>}<div className="sub">{p.role} · {p.team}{p.played ? '' : ' · did not play'}</div></td>
            <td style={{ textAlign: 'right' }}><b className="num">{p.actual}</b>{p.badge && <div className="sub">counted {p.counted}</div>}</td>
          </tr>
        ))}
      </tbody></table>
      <div className="sub">✓ = also in the {mark === 'inTop11' ? 'real top 11' : 'agent’s team'}</div>
    </div>
  );
}

function Compare({ title, a, b, labelKey }: { title: string; a: any[]; b: any; labelKey: string }) {
  return (
    <div className="rp-box">
      <div className="pf-label">{title}</div>
      <table className="t"><thead><tr><td className="sub"></td><td className="sub">Our picks</td><td className="sub">Real top 11</td></tr></thead><tbody>
        {a.map((r) => (
          <tr key={r[labelKey]}><td>{r[labelKey]}</td><td><b className="num">{r.ourN}</b> <span className="sub">players · {r.ourPts} pts</span></td><td><b className="num">{r.topN}</b> <span className="sub">players · {r.topPts} pts</span></td></tr>
        ))}
      </tbody></table>
    </div>
  );
}

type Item = { key: string; kind: string; title: string; date: string | null; ourPoints?: number; topPoints?: number };

function MatchPicker({ list, value, onPick }: { list: Item[]; value: string; onPick: (k: string) => void }) {
  const [q, setQ] = useState('');
  const now = Date.now();
  const shown = list.filter((m) => m.title.toLowerCase().includes(q.trim().toLowerCase()));
  const done = shown.filter((m) => m.kind === 'backtest' || (m.date && new Date(m.date).getTime() < now));
  const soon = shown.filter((m) => !done.includes(m));
  const card = (m: Item) => {
    const [a, b] = m.title.split(/\s+vs?\.?\s+/i).map((x) => x.split(',')[0].trim());
    const pct = m.ourPoints && m.topPoints ? Math.round((m.ourPoints / m.topPoints) * 100) : null;
    return (
      <button key={m.key} className={`mp-card ${m.key === value ? 'on' : ''}`} onClick={() => onPick(m.key)} aria-pressed={m.key === value}>
        <div className="row" style={{ gap: 6 }}><span className="d-code sm">{short(a || '')}</span><span className="vs">v</span><span className="d-code sm b">{short(b || '')}</span></div>
        <div className="mp-title">{m.title.split(',')[0]}</div>
        <div className="sub">{m.date ? new Date(m.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</div>
        {m.kind === 'backtest' ? <div className="mp-score"><b className="num">{pct}%</b><span> of the best team · {m.ourPoints} / {m.topPoints}</span></div> : <div className="mp-score"><span className="pill warn">Live team</span></div>}
      </button>
    );
  };
  return (
    <div className="mp">
      <input type="text" className="search" placeholder="Search a team…" value={q} onChange={(e) => setQ(e.target.value)} />
      {done.length > 0 && <><div className="daylabel">Played</div><div className="mp-grid">{done.map(card)}</div></>}
      {soon.length > 0 && <><div className="daylabel">Not played yet</div><div className="mp-grid">{soon.map(card)}</div></>}
      {shown.length === 0 && <p className="sub">No match found.</p>}
    </div>
  );
}

export default function Report() {
  const [list, setList] = useState<{ key: string; kind: string; title: string; date: string | null }[] | null>(null);
  const [key, setKey] = useState('');
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { api('/api/report').then((r) => { setList(r.matches); const played = r.matches.find((m: any) => m.date && new Date(m.date).getTime() < Date.now()) ?? r.matches[0]; // open on the latest match that has been played
      if (played) setKey(played.key); }).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    if (!key) return;
    setBusy(true); setErr('');
    api(`/api/report?key=${encodeURIComponent(key)}`).then(setD).catch((e) => setErr(e.message)).finally(() => setBusy(false));
  }, [key]);

  if (err && !list) return <Banner kind="bad">{err}</Banner>;
  if (!list) return <div className="skel" style={{ height: 240, marginTop: 14 }} />;
  const r = d?.report;
  const h = r?.headline;

  return (
    <>
      <h1>Match Report</h1>
      <p className="sub">Pick one match to see exactly what the agent chose, how those players scored against the real top 11, and where it fell short. This page is about one match only; the all-matches view that trains the model is under Insights.</p>
      <MatchPicker list={list} value={key} onPick={(k) => { setKey(k); setTimeout(() => document.getElementById('report-top')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 150); }} />
      <div id="report-top" style={{ scrollMarginTop: 70 }} />
      {list.length === 0 && <p className="sub">No team has been built yet. Build a team for a match and it appears here.</p>}
      {err && <Banner kind="bad">{err}</Banner>}
      {busy && <div className="skel" style={{ height: 200, marginTop: 14 }} />}

      {d && !busy && (
        <>
          <div className="pf-stamp">Team recommended by the agent on <b>{when(d.recommendedAt)}</b>{d.venue ? ` · ${d.venue}` : ''}</div>
          {d.pending && <Banner kind="warn">{d.pending}</Banner>}
          {r && (
            <>
              <div className="rp-tiles">
                <Tile k="Our team scored" v={`${h.ourPoints}`} s={`${h.pctOfTop}% of the best possible`} />
                <Tile k="Real top 11 scored" v={`${h.topPoints}`} s="best valid team in hindsight" />
                <Tile k="Picks in the top 11" v={`${h.overlap}/${h.size}`} tone={h.overlap >= 6 ? 'good' : h.overlap <= 3 ? 'bad' : undefined} />
                <Tile k="Captain" v={`#${h.captain.rank}`} s={`${h.captain.name} scored ${h.captain.points} (of ${h.captain.of} players)`} tone={h.captain.rank <= 3 ? 'good' : h.captain.rank > Math.ceil(h.captain.of * 0.25) ? 'bad' : undefined} />
                <Tile k="Avg miss per player" v={h.mae === null ? '–' : `${h.mae}`} s={h.maeBaseline === null ? 'points' : `vs ${h.maeBaseline} for a last-5 average`} />
                {h.baselinePoints !== null && <Tile k="Plain last-5 team" v={`${h.baselinePoints}`} s={h.baselinePoints > h.ourPoints ? 'beat us' : 'we beat it'} />}
              </div>

              <h2>Where it lagged</h2>
              <div className="card"><ul className="rp-list">{r.lags.map((l: string, i: number) => <li key={i}>{l}</li>)}</ul></div>

              <h2>Our picks vs the real top 11</h2>
              <div className="rp-two">
                <TeamTable title="What the agent picked" rows={r.ours} mark="inTop11" />
                <TeamTable title="The real top 11 (best valid team)" rows={r.top11} mark="inOurXI" />
              </div>

              {r.missed.length > 0 && (
                <>
                  <h2>Top-11 players we missed</h2>
                  {r.missed.map((p: any) => (
                    <div key={p.name} className="card rp-miss">
                      <div className="row sb"><b>{p.name} <span className="sub">{p.role} · {p.team}</span></b><b className="num">{p.actual} pts</b></div>
                      <div className="sub" style={{ marginTop: 4 }}>{p.why}</div>
                    </div>
                  ))}
                </>
              )}

              {r.flops.length > 0 && (
                <>
                  <h2>Our picks that disappointed</h2>
                  {r.flops.map((p: any) => (
                    <div key={p.name} className="card rp-miss">
                      <div className="row sb"><b>{p.name} <span className="sub">{p.role} · {p.team}</span></b><b className="num">{p.actual} pts</b></div>
                      <div className="sub" style={{ marginTop: 4 }}>{p.why}</div>
                      {p.reason && <div className="sub" style={{ marginTop: 4 }}><i>Why we picked him:</i> {p.reason}</div>}
                    </div>
                  ))}
                </>
              )}

              <h2>Key metrics</h2>
              <div className="rp-two">
                <Compare title="By role" a={r.byRole} b={null} labelKey="role" />
                <Compare title="By batting position" a={r.byPosition} b={null} labelKey="bucket" />
              </div>

              <details className="card" style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Every player: expected vs actual ({r.everyone.length})</summary>
                <div style={{ overflowX: 'auto' }}>
                  <table className="t">
                    <thead><tr><td className="sub">Player</td><td className="sub">Role</td><td className="sub">Bat</td><td className="sub">Expected</td><td className="sub">Actual</td><td className="sub">Miss</td><td className="sub">History</td><td className="sub">Picked</td><td className="sub">Top 11</td></tr></thead>
                    <tbody>
                      {r.everyone.map((p: any) => (
                        <tr key={p.name + p.team}>
                          <td>{p.name}<div className="sub">{p.team}</div></td><td>{p.role}</td><td>{p.batPos ?? '–'}</td>
                          <td className="num">{p.predicted ?? '–'}</td><td className="num"><b>{p.actual}</b></td>
                          <td className="num" style={{ color: p.predicted === null ? undefined : p.actual - p.predicted >= 0 ? 'var(--good)' : 'var(--red)' }}>{p.predicted === null ? '–' : sign(Math.round((p.actual - p.predicted) * 10) / 10)}</td>
                          <td className="num">{p.base === null ? 'none' : Math.round(p.base * 10) / 10}</td>
                          <td>{p.inOurXI ? '✓' : ''}</td><td>{p.inTop11 ? '✓' : ''}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>

              {d.notes?.length > 0 && (
                <details style={{ marginTop: 10 }}><summary className="sub" style={{ cursor: 'pointer' }}>How this team was built (conditions)</summary>
                  {d.notes.map((n: string, i: number) => <p key={i} className="sub" style={{ margin: '4px 0' }}>• {n}</p>)}
                </details>
              )}
              <p className="sub" style={{ marginTop: 12 }}>Source: {d.source}. Points use the Dream11 T20 scoring table; the captain counts 2x and the vice-captain 1.5x. For patterns across all matches, see <Link href="/insights" style={{ textDecoration: 'underline' }}>Insights</Link>.</p>
            </>
          )}
        </>
      )}
    </>
  );
}
