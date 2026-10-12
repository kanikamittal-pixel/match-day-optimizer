'use client';
import { useState } from 'react';
import { api } from '@/frontend/api';
import { Banner, Spinner } from './ui';

interface P { name_key: string; name: string; team: string; role: string }
interface XI { teamA: string[]; teamB: string[]; impact: string[]; confirmed: boolean; source: string }
type Source = { title: string; uri: string };

export default function XIEditor({ matchId, teamA, teamB, players, initial, toss, isManual, onSaved }: { matchId: string; teamA: string; teamB: string; players: P[]; initial: XI | null; toss: { winner?: string; decision?: string } | null; isManual: boolean; onSaved: (xi: XI) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set([...(initial?.teamA ?? []), ...(initial?.teamB ?? [])]));
  const [impact, setImpact] = useState<Set<string>>(new Set(initial?.impact ?? []));
  const [confirmed, setConfirmed] = useState(initial?.confirmed ?? false);
  const [pasted, setPasted] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [tossInfo, setTossInfo] = useState(toss);
  // announcement status after a lookup: null = not checked yet
  const [announce, setAnnounce] = useState<null | { announced: boolean; note: string; sources: Source[]; unmatched: string[] }>(null);
  const [savedMsg, setSavedMsg] = useState('');

  const toggle = (set: Set<string>, k: string, fn: (s: Set<string>) => void) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); fn(n); setSavedMsg(''); };
  const countA = players.filter((p) => p.team === teamA && sel.has(p.name_key)).length;
  const countB = players.filter((p) => p.team === teamB && sel.has(p.name_key)).length;

  async function findXI() {
    setErr(''); setSavedMsg(''); setAnnounce(null);
    try {
      if (!isManual) {
        setBusy('Checking toss…');
        try { const r = await api(`/api/matches/${matchId}/xi`, { method: 'POST' }); setTossInfo(r.toss); } catch { /* toss is optional */ }
      }
      setBusy('Looking for the announced playing XI…');
      const r = await api(`/api/matches/${matchId}/xi/lookup`, { method: 'POST' });
      if (r.announced) {
        setSel(new Set([...r.teamA, ...r.teamB])); setImpact(new Set(r.impact)); setConfirmed(true);
        setAnnounce({ announced: true, note: r.note, sources: r.sources, unmatched: r.unmatched });
      } else {
        setConfirmed(false);
        setAnnounce({ announced: false, note: r.note, sources: r.sources, unmatched: [] });
      }
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  async function save(withPaste = false) {
    setBusy('Saving…'); setErr(''); setSavedMsg('');
    const body: any = withPaste ? { pasted, confirmed } : {
      teamA: players.filter((p) => p.team === teamA && sel.has(p.name_key)).map((p) => p.name_key),
      teamB: players.filter((p) => p.team === teamB && sel.has(p.name_key)).map((p) => p.name_key),
      impact: [...impact],
      confirmed, source: confirmed ? 'manual' : 'probable',
    };
    try {
      const r = await api(`/api/matches/${matchId}/xi`, { method: 'PUT', json: body });
      setSel(new Set([...r.xi.teamA, ...r.xi.teamB])); setImpact(new Set(r.impact ?? r.xi.impact));
      const unmatched = r.unmatched?.length ? ` Couldn’t match: ${r.unmatched.join(', ')}. Tick them below.` : '';
      setSavedMsg(`✓ Saved: ${r.xi.teamA.length} ${teamA} + ${r.xi.teamB.length} ${teamB} players as the ${r.xi.confirmed ? 'confirmed' : 'probable'} XI.${unmatched}`);
      if (withPaste) setShowPaste(false);
      onSaved(r.xi);
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  if (!players.length) return <Banner>Confirm the credit table first. The XI is chosen from those players.</Banner>;
  return (
    <div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn primary" onClick={findXI} disabled={!!busy}>Find announced XI</button>
        <button className="btn ghost" onClick={() => setShowPaste(!showPaste)}>Paste XI</button>
      </div>
      {busy && <p className="sub"><Spinner /> {busy}</p>}
      {tossInfo?.winner && <Banner kind="ok">Toss: {tossInfo.winner} won and chose to {tossInfo.decision}.</Banner>}
      {announce && !announce.announced && (
        <Banner kind="warn">
          <b>Team announcement is not yet done.</b> Select the <b>probable playing 11</b> below to make the fantasy team, then rebuild once the XI is announced.
          {announce.note && <div className="sub" style={{ marginTop: 4 }}>{announce.note}</div>}
        </Banner>
      )}
      {announce?.announced && (
        <Banner kind="ok">
          <b>Announced XI found</b> and ticked below. It comes from a web search, so check it against Dream11 before you save.
          {announce.unmatched.length > 0 && <div style={{ marginTop: 4 }}>Not in your credit table: {announce.unmatched.join(', ')}. Add them to the table to include them.</div>}
          {announce.sources.length > 0 && <div className="sub" style={{ marginTop: 4 }}>Sources: {announce.sources.slice(0, 4).map((s, i) => (<a key={i} href={s.uri} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', marginRight: 8 }}>{s.title || 'source'}</a>))}</div>}
        </Banner>
      )}
      {err && <Banner kind="bad">{err}</Banner>}
      {showPaste && (
        <div className="stack" style={{ margin: '10px 0' }}>
          <textarea rows={7} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder={`One name per line (initials are fine).\nAdd "Impact:" before impact substitutes.`} />
          <button className="btn block" onClick={() => save(true)} disabled={!pasted.trim() || !!busy}>Apply pasted XI</button>
        </div>
      )}
      {[teamA, teamB].map((t) => (
        <div key={t} style={{ marginTop: 14 }}>
          <div className="row sb"><b>{t}</b><span className="sub num">{t === teamA ? countA : countB} / 11 selected</span></div>
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
        <input type="checkbox" style={{ width: 22, height: 22 }} checked={confirmed} onChange={(e) => { setConfirmed(e.target.checked); setSavedMsg(''); }} />
        <span><b>This is the confirmed XI</b> <span className="sub">(untick for a pre-toss run on a probable XI)</span></span>
      </label>
      <button className="btn primary block" onClick={() => save()} disabled={!!busy || countA + countB < 11}>
        {countA + countB < 11 ? `Select 11 players (${countA + countB} so far)` : `Save ${confirmed ? 'confirmed' : 'probable'} XI`}
      </button>
      {savedMsg && <Banner kind="ok">{savedMsg}</Banner>}
    </div>
  );
}
