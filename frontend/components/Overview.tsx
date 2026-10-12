'use client';
import { useEffect, useState } from 'react';
import { api } from '@/frontend/api';
import { Banner } from './ui';

type Rec = any;
const w = (v: number, max: number) => `${Math.max(2, Math.round((v / Math.max(max, 1)) * 100))}%`;

function Tile({ k, v, s }: { k: string; v: string; s: string }) {
  return <div className="tile"><div className="k">{k}</div><div className="v num">{v}</div><div className="s">{s}</div></div>;
}

/** The picture first: a few numbers and charts, with one line of explanation under each. */
export default function Overview() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/api/insights/backtests').then(setD).catch((e) => setErr(e.message)); }, []);
  if (err) return <Banner kind="bad">{err}</Banner>;
  if (!d) return <div className="skel" style={{ height: 260, marginTop: 14 }} />;
  if (!d.matches.length) return <Banner>No back-tests yet.</Banner>;

  const latest: Rec[] = d.matches.map((v: Rec[]) => v[0]);
  const f = d.formulas;
  const avgPct = Math.round(latest.reduce((s, r) => s + r.metrics.agentPctOfHindsight, 0) / latest.length);
  const overlap = latest.map((r) => r.players.filter((p: any) => p.inAgentXI && p.inHindsightXI).length);
  const avgOverlap = (overlap.reduce((s, x) => s + x, 0) / overlap.length).toFixed(1);
  const beats = latest.filter((r) => r.metrics.agent > r.metrics.baseline).length;
  const capTop3 = latest.filter((r) => r.metrics.captainRank <= 3).length;
  const maxPts = Math.max(...latest.flatMap((r) => [r.metrics.agent, r.metrics.baseline, r.metrics.hindsight]));
  const methods: any[] = f ? [...f.table].sort((a: any, b: any) => a.mae - b.mae).slice(0, 7) : [];
  const maxMae = methods.length ? Math.max(...methods.map((m) => m.mae)) : 1;
  const roles = ['WK', 'BAT', 'AR', 'BOWL'];
  const bias = (r: Rec, role: string) => r.byRole.find((g: any) => g.key === role)?.bias as number | undefined;
  const heat = (v: number | undefined) => (typeof v !== 'number' ? 'transparent' : v > 0 ? `color-mix(in srgb, var(--red) ${Math.min(70, Math.abs(v) * 2.2)}%, transparent)` : `color-mix(in srgb, var(--blue) ${Math.min(70, Math.abs(v) * 2.2)}%, transparent)`);

  return (
    <>
      <div className="tiles ov-tiles" style={{ marginTop: 12 }}>
        <Tile k="Matches back-tested" v={`${latest.length}`} s="finished matches replayed" />
        <Tile k="Of the best team" v={`${avgPct}%`} s="average points vs the top 11" />
        <Tile k="Picks in the top 11" v={`${avgOverlap}/11`} s="average per match" />
        <Tile k="Beat a last-5 team" v={`${beats}/${latest.length}`} s={`captain in top 3: ${capTop3}/${latest.length}`} />
      </div>

      <h2>Points per match</h2>
      <div className="card">
        <div className="ov-legend"><i className="lg us" /> Our team <i className="lg base" /> Last-5 average team <i className="lg best" /> Best possible</div>
        {latest.map((r) => (
          <div key={r.ref} className="ov-match">
            <div className="ov-title">{r.title}<span className="sub"> · {new Date(r.date).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span></div>
            {[['us', r.metrics.agent], ['base', r.metrics.baseline], ['best', r.metrics.hindsight]].map(([cls, v]: any) => (
              <div key={cls} className="ov-row"><div className="bt-track"><div className={`bt-fill ${cls}`} style={{ width: w(v, maxPts) }} /></div><b className="num">{v}</b></div>
            ))}
          </div>
        ))}
        <div className="sub">Longer bar = more fantasy points. We never reach the best team: it is picked knowing the result.</div>
      </div>

      {methods.length > 0 && (
        <>
          <h2>Which method predicts best</h2>
          <div className="card">
            {methods.map((m: any, i: number) => (
              <div key={m.id} className="bt-bar ov-method"><span className="bt-l" title={m.label}>{m.label}</span><div className="bt-track"><div className={`bt-fill ${i === 0 ? 'best' : 'base'}`} style={{ width: w(m.mae, maxMae) }} /></div><b className="num">{m.mae}</b></div>
            ))}
            <div className="sub">Average points missed per player over {f.matches.toLocaleString()} past matches. Shorter is better; the green bar is the best.</div>
          </div>
        </>
      )}

      <div className="ov-two">
        {f?.captainByRank && (
          <div>
            <h2>Captain pick</h2>
            <div className="card">
              {f.captainByRank.slice(0, 6).map((c: any) => (
                <div key={c.rank} className="bt-bar"><span className="bt-l">#{c.rank} on our list</span><div className="bt-track"><div className="bt-fill us" style={{ width: w(c.avgActual, f.captainByRank[0].avgActual) }} /></div><b className="num">{c.avgActual}</b></div>
              ))}
              <div className="sub">Points the player at each rank actually scores. Our top pick scores the most, so the ranking works.</div>
            </div>
          </div>
        )}
        <div>
          <h2>Where we guess wrong</h2>
          <div className="card">
            <div className="ov-heat" style={{ gridTemplateColumns: `60px repeat(${latest.length}, 1fr)` }}>
              <span />{latest.map((r) => <span key={r.ref} className="ov-hc sub">{r.title.split(' v ').map((t: string) => t.slice(0, 3).toUpperCase()).join(' v ')}</span>)}
              {roles.map((role) => (
                <div key={role} style={{ display: 'contents' }}>
                  <b className="ov-rl">{role}</b>
                  {latest.map((r) => { const v = bias(r, role); return <span key={r.ref} className="ov-cell num" style={{ background: heat(v) }}>{typeof v === 'number' ? `${v > 0 ? '+' : ''}${Math.round(v)}` : '–'}</span>; })}
                </div>
              ))}
            </div>
            <div className="sub">Red: we guessed too high. Blue: too low. Points per player.</div>
          </div>
        </div>
      </div>

      {d.changes?.length > 0 && (
        <>
          <h2>What we changed after testing</h2>
          <div className="card">
            {d.changes.map((c: any) => (
              <div key={c.title} className="ov-change"><span>{c.title}</span><span className={`pill ${c.status === 'adopted' ? 'ok' : c.status === 'not adopted' ? '' : 'warn'}`}>{c.status}</span></div>
            ))}
            <div className="sub">Details are under Back-tests.</div>
          </div>
        </>
      )}
    </>
  );
}
