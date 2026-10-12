'use client';
import { useEffect, useState } from 'react';
import { api } from '@/frontend/api';
import { Banner } from '@/frontend/components/ui';

const ROLES = ['WK', 'BAT', 'AR', 'BOWL'];
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

function TeamList({ team, label }: { team: { xi: { name: string; role: string; team: string }[]; captain: string; vc: string }; label: string }) {
  return (
    <div className="pf-team">
      <div className="pf-label">{label}</div>
      {ROLES.map((r) => {
        const ps = team.xi.filter((p) => p.role === r);
        if (!ps.length) return null;
        return (
          <div key={r} className="pf-role"><span className="pf-r">{r}</span>
            {ps.map((p) => (
              <span key={p.name} className="pf-p">{p.name}{p.name === team.captain && <b className="badge-c">C</b>}{p.name === team.vc && <b className="badge-vc">VC</b>}</span>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function Outcome({ item }: { item: any }) {
  const r = item.result;
  if (!r) return <div className="banner" style={{ marginTop: 10 }}>{item.resultNote}</div>;
  const played = r.picks.filter((p: any) => p.played).length;
  return (
    <div className="pf-result">
      <div className="pf-label">What actually happened</div>
      <div className="pf-score">
        <div><b className="num">{r.total}</b><span>points from this team</span></div>
        {r.bestPossible !== null && <div><b className="num">{r.bestPossible}</b><span>best possible valid team</span></div>}
        <div><b className="num">{played}/{r.picks.length}</b><span>picks actually played</span></div>
      </div>
      <table className="t">
        <tbody>
          {r.picks.map((p: any) => (
            <tr key={p.name} className={p.played ? '' : 'pf-out'}>
              <td>{p.name}{p.badge === 'C' && <b className="badge-c">C</b>}{p.badge === 'VC' && <b className="badge-vc">VC</b>}<div className="sub">{p.role} · {p.team}</div></td>
              <td style={{ textAlign: 'right' }}>{p.played ? <><b className="num">{p.points}</b>{p.badge && <div className="sub">counted {p.counted}</div>}</> : <span className="pill warn">did not play</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <details style={{ marginTop: 8 }}>
        <summary className="sub" style={{ cursor: 'pointer' }}>Everyone who played ({r.playedCount} players, best first)</summary>
        <table className="t"><tbody>
          {r.everyone.map((p: any) => (
            <tr key={p.name + p.team} className={p.picked ? 'pf-picked' : ''}><td>{p.picked ? '✓ ' : ''}{p.name}<span className="sub">{p.team ? ` · ${p.team}` : ''}</span></td><td style={{ textAlign: 'right' }} className="num">{p.points}</td></tr>
          ))}
        </tbody></table>
      </details>
      <div className="sub" style={{ marginTop: 6 }}>Source: {r.source}. Points use the Dream11 T20 scoring table; the captain counts 2x and the vice-captain 1.5x.</div>
    </div>
  );
}

function Card({ item }: { item: any }) {
  return (
    <div className="card pf-card">
      <div className="row sb" style={{ alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 17 }}>{item.title}</div>
          <div className="sub">{item.date ? new Date(item.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : ''}{item.stage ? ` · ${item.stage === 'pre_toss' ? 'pre-toss, probable XI' : 'confirmed XI'}` : ''}</div>
        </div>
        <span className={`pill ${item.kind === 'live' ? 'ok' : ''}`}>{item.kind === 'live' ? 'Live match' : 'Back-test'}</span>
      </div>
      <div className="pf-stamp">Recommended by the agent on <b>{when(item.recommendedAt)}</b></div>
      <TeamList team={item.recommended} label="The agent's recommended team" />
      {item.final && <TeamList team={item.final} label="Aryan's final team (changed by hand)" />}
      {item.note && <p className="sub" style={{ margin: '8px 0 0' }}>{item.note}</p>}
      {item.log?.length > 1 && (
        <details style={{ marginTop: 8 }}><summary className="sub" style={{ cursor: 'pointer' }}>Recommendation log ({item.log.length} versions)</summary>
          {item.log.map((l: any) => <div key={l.at} className="sub" style={{ marginTop: 4 }}>{when(l.at)} · {l.stage === 'pre_toss' ? 'pre-toss' : 'final XI'} · C {l.captain} · VC {l.vc}</div>)}
        </details>
      )}
      <Outcome item={item} />
    </div>
  );
}

export default function Proof() {
  const [d, setD] = useState<{ items: any[] } | null>(null);
  const [err, setErr] = useState('');
  const load = () => api('/api/proof').then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);
  if (err) return <Banner kind="bad">{err}</Banner>;
  if (!d) return <div className="skel" style={{ height: 240, marginTop: 14 }} />;
  const live = d.items.filter((i) => i.kind === 'live');
  const bt = d.items.filter((i) => i.kind === 'backtest');
  return (
    <>
      <h1>Proof of recommendations</h1>
      <p className="sub">Every team the agent recommended is stored with the time it was made. Below each team is what actually happened: the players who really played in the match and the points they scored, read by the app itself from the ball-by-ball record. Nobody uploads anything.</p>
      <h2>Live matches</h2>
      {live.length === 0 && <p className="sub">No live recommendation yet. Build a team for a match and it appears here.</p>}
      {live.map((i) => <Card key={i.key} item={i} />)}
      <h2>Matches already played</h2>
      <p className="sub" style={{ marginTop: 0 }}>For finished matches the team was built before the result was read (see Insights, Back-tests).</p>
      {bt.map((i) => <Card key={i.key} item={i} />)}
    </>
  );
}
