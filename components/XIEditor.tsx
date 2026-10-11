'use client';
import { useState } from 'react';
import { api } from '@/lib/client';
import { Banner, Spinner } from './ui';

interface P { name_key: string; name: string; team: string; role: string }
interface XI { teamA: string[]; teamB: string[]; impact: string[]; confirmed: boolean; source: string }

export default function XIEditor({ matchId, teamA, teamB, players, initial, toss, isManual, onSaved }: { matchId: string; teamA: string; teamB: string; players: P[]; initial: XI | null; toss: { winner?: string; decision?: string } | null; isManual: boolean; onSaved: (xi: XI) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set([...(initial?.teamA ?? []), ...(initial?.teamB ?? [])]));
  const [impact, setImpact] = useState<Set<string>>(new Set(initial?.impact ?? []));
  const [confirmed, setConfirmed] = useState(initial?.confirmed ?? false);
  const [pasted, setPasted] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [tossInfo, setTossInfo] = useState(toss);

  const toggle = (set: Set<string>, k: string, fn: (s: Set<string>) => void) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); fn(n); };
  const countA = players.filter((p) => p.team === teamA && sel.has(p.name_key)).length;
  const countB = players.filter((p) => p.team === teamB && sel.has(p.name_key)).length;

  async function fetchApi() {
    setBusy('Checking CricketData…'); setErr('');
    try {
      const r = await api(`/api/matches/${matchId}/xi`, { method: 'POST' });
      setTossInfo(r.toss);
      setNote(r.note + (r.tossDone ? '' : ' Toss not reported yet.'));
      if (r.xi) { setSel(new Set([...r.xi.teamA, ...r.xi.teamB])); }
    } catch (e: any) { setErr(e.message + ' Enter the XI below instead.'); }
    setBusy('');
  }

  async function save(withPaste = false) {
    setBusy('Saving…'); setErr('');
    const body: any = withPaste ? { pasted, confirmed } : {
      teamA: players.filter((p) => p.team === teamA && sel.has(p.name_key)).map((p) => p.name_key),
      teamB: players.filter((p) => p.team === teamB && sel.has(p.name_key)).map((p) => p.name_key),
      impact: [...impact].filter((k) => sel.has(k) || true),
      confirmed, source: confirmed ? 'manual' : 'probable',
    };
    try {
      const r = await api(`/api/matches/${matchId}/xi`, { method: 'PUT', json: body });
      setSel(new Set([...r.xi.teamA, ...r.xi.teamB])); setImpact(new Set(r.xi.impact));
      if (r.unmatched.length) setNote(`Couldn’t match: ${r.unmatched.join(', ')}. Tick them below.`); else setNote('');
      if (withPaste) setShowPaste(false);
      onSaved(r.xi);
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  if (!players.length) return <Banner>Confirm the credit table first. The XI is chosen from those players.</Banner>;
  return (
    <div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {!isManual && <button className="btn" onClick={fetchApi} disabled={!!busy}>Fetch toss from API</button>}
        <button className="btn ghost" onClick={() => setShowPaste(!showPaste)}>Paste XI</button>
      </div>
      {busy && <p className="sub"><Spinner /> {busy}</p>}
      {tossInfo?.winner && <Banner kind="ok">Toss: {tossInfo.winner} won and chose to {tossInfo.decision}.</Banner>}
      {note && <Banner>{note}</Banner>}
      {err && <Banner kind="bad">{err}</Banner>}
      {showPaste && (
        <div className="stack" style={{ margin: '10px 0' }}>
          <textarea rows={7} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={`One name per line (initials are fine).\nAdd "Impact:" before impact substitutes.`} />
          <button className="btn block" onClick={() => save(true)} disabled={!pasted.trim() || !!busy}>Apply pasted XI</button>
        </div>
      )}
      {[teamA, teamB].map((t) => (
        <div key={t} style={{ marginTop: 14 }}>
          <div className="row sb"><b>{t}</b><span className="sub num">{t === teamA ? countA : countB} in XI</span></div>
          {players.filter((p) => p.team === t).map((p) => (
            <div key={p.name_key} className="row" style={{ padding: '7px 0', borderTop: '1px solid var(--line)' }}>
              <input type="checkbox" style={{ width: 22, height: 22 }} checked={sel.has(p.name_key)} onChange={() => toggle(sel, p.name_key, setSel)} />
              <span className="grow">{p.name} <span className="sub">{p.role}</span></span>
              <label className="sub row" style={{ gap: 4 }}><input type="checkbox" checked={impact.has(p.name_key)} onChange={() => toggle(impact, p.name_key, setImpact)} />Impact sub</label>
            </div>
          ))}
        </div>
      ))}
      <label className="row" style={{ margin: '14px 0 8px', gap: 10 }}>
        <input type="checkbox" style={{ width: 22, height: 22 }} checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        <span><b>This is the confirmed XI</b> <span className="sub">(untick for a pre-toss run on a probable XI)</span></span>
      </label>
      <button className="btn primary block" onClick={() => save()} disabled={!!busy || countA + countB < 11}>Save {confirmed ? 'confirmed' : 'probable'} XI</button>
    </div>
  );
}
