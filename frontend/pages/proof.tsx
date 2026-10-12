'use client';
import { useEffect, useRef, useState } from 'react';
import { api, imageToPayload } from '@/frontend/api';
import { Banner, Spinner, short } from '@/frontend/components/ui';

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

function Verdict({ r }: { r: any }) {
  const good = r.exact && r.captain.ok !== false && r.vc.ok !== false;
  return (
    <div className={`banner ${good ? 'ok' : 'warn'}`} style={{ marginTop: 8 }}>
      <b>{r.matched} of {r.total} players match</b> the {r.against} team
      {r.captain.read ? <> · captain {r.captain.ok ? '✓' : `✗ (screenshot shows ${r.captain.read})`}</> : ' · captain badge not visible'}
      {r.vc.read ? <> · vice-captain {r.vc.ok ? '✓' : `✗ (screenshot shows ${r.vc.read})`}</> : ' · vice-captain badge not visible'}
      {r.missing.length > 0 && <div className="sub">Not on your screenshot: {r.missing.join(', ')}</div>}
      {r.unmatched.length > 0 && <div className="sub">On your screenshot but not recommended: {r.unmatched.join(', ')}</div>}
      <div className="sub">Checked {when(r.checkedAt)}</div>
    </div>
  );
}

function Card({ item, reload }: { item: any; reload: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [which, setWhich] = useState<'recommended' | 'final'>('recommended');
  const results = item.proof?.results ?? [];

  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true); setErr('');
    try {
      const images = await Promise.all([...files].slice(0, 3).map(async (f) => {
        return imageToPayload(f, 1100, 0.72); // small enough to store as evidence and to upload three at once
      }));
      await api('/api/proof', { method: 'POST', json: { key: item.key, images, which } });
      reload();
    } catch (e: any) { setErr(e.message); }
    setBusy(false);
    if (file.current) file.current.value = '';
  }

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

      <div className="pf-upload">
        <b>Show that this team was created</b>
        <p className="sub" style={{ margin: '2px 0 8px' }}>Optional: upload a screenshot (up to 3) of the team in Dream11. I read the players and the C and VC badges and check them against the recommendation above.</p>
        {item.final && (
          <div className="seg compact" style={{ marginBottom: 8 }}>
            <button className={which === 'recommended' ? 'on' : ''} onClick={() => setWhich('recommended')}>Check against the agent's team</button>
            <button className={which === 'final' ? 'on' : ''} onClick={() => setWhich('final')}>Check against Aryan's final</button>
          </div>
        )}
        <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => upload(e.target.files)} />
        <button className="btn primary" disabled={busy} onClick={() => file.current?.click()}>{busy ? <><Spinner /> Reading…</> : '📷 Add a Dream11 screenshot (optional)'}</button>
        {err && <Banner kind="bad">{err}</Banner>}
        {results[0] && <Verdict r={results[0]} />}
        {item.proof?.images?.length > 0 && (
          <div className="pf-shots">{item.proof.images.map((src: string, i: number) => <a key={i} href={src} target="_blank" rel="noreferrer"><img src={src} alt={`Team screenshot ${i + 1}`} /></a>)}</div>
        )}
      </div>
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
      <p className="sub">Every team the agent recommended is stored with the time it was made. Nothing needs uploading: each team below was built before the match, stored with its time, and for finished matches it is scored against the real result. A screenshot is optional and only shows that the team was also created in Dream11 itself; the app checks it player by player.</p>
      <h2>Live matches</h2>
      {live.length === 0 && <p className="sub">No live recommendation yet. Build a team for a match and it appears here.</p>}
      {live.map((i) => <Card key={i.key} item={i} reload={load} />)}
      <h2>Matches already played</h2>
      <p className="sub" style={{ marginTop: 0 }}>For finished matches the team was built before the result was read (see Insights, Back-tests).</p>
      {bt.map((i) => <Card key={i.key} item={i} reload={load} />)}
    </>
  );
}
