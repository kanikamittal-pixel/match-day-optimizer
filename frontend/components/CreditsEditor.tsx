'use client';
import { useRef, useState } from 'react';
import { api, imageToPayload } from '@/frontend/api';
import { Banner, Spinner } from '@/frontend/components/ui';
import { ROLES } from '@/shared/types';

export interface CreditRow { name: string; team: string; role: string; credit: number | string; prev_credit?: number | null; changed?: boolean }

export default function CreditsEditor({ matchId, teams, initial, onSaved }: { matchId: string; teams: [string, string]; initial: CreditRow[]; onSaved: (n: number) => void }) {
  const [rows, setRows] = useState<CreditRow[]>(initial);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState(initial.length > 0);
  const file = useRef<HTMLInputElement>(null);

  const set = (i: number, patch: Partial<CreditRow>) => { setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r))); setSaved(false); };

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy('Reading screenshots…'); setErr('');
    try {
      const images = await Promise.all([...files].slice(0, 3).map(imageToPayload));
      const { rows: out } = await api(`/api/matches/${matchId}/credits/extract`, { method: 'POST', json: { images } });
      // merge: extracted rows win, keep any manual rows not in the screenshots
      const seen = new Set(out.map((r: CreditRow) => r.name.toLowerCase()));
      setRows([...out, ...rows.filter((r) => !seen.has(r.name.toLowerCase()))]);
      setSaved(false);
    } catch (e: any) { setErr(`${e.message} You can type the table by hand instead.`); }
    setBusy('');
    if (file.current) file.current.value = '';
  }

  async function prefill() {
    setBusy('Loading last known credits…');
    try { const { rows: r, apiSquad } = await api(`/api/matches/${matchId}/credits`); setRows(r); setSaved(false); if (!r.length) setErr('No squad or past credits found for this match. Upload a Dream11 screenshot or type the players in.'); else if (apiSquad) setErr(`${apiSquad} real squad players loaded from the cricket API. Add their credits.`); } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  async function confirm() {
    setBusy('Saving…'); setErr('');
    try { const { saved: n } = await api(`/api/matches/${matchId}/credits`, { method: 'PUT', json: { rows } }); setSaved(true); onSaved(n); } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  const changed = rows.filter((r) => r.changed).length;
  return (
    <div>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        <button className="btn primary" onClick={() => file.current?.click()} disabled={!!busy}>Upload 1–3 screenshots</button>
        <button className="btn ghost" onClick={prefill} disabled={!!busy}>Load squad & last credits</button>
        <button className="btn ghost" onClick={() => { setRows([...rows, { name: '', team: teams[0], role: 'BAT', credit: '' }]); setSaved(false); }}>+ Player</button>
      </div>
      {busy && <p className="sub"><Spinner /> {busy}</p>}
      {err && <Banner kind="bad">{err}</Banner>}
      {changed > 0 && <Banner kind="warn">{changed} credit{changed > 1 ? 's' : ''} changed since the player’s last match (highlighted). Check them.</Banner>}
      {rows.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {rows.map((r, i) => (
            <div key={i} className={`credit-row ${r.changed ? 'changed' : ''}`}>
              <input type="text" value={r.name} placeholder="Player name" onChange={(e) => set(i, { name: e.target.value })} />
              <input type="number" step="0.5" inputMode="decimal" value={r.credit} onChange={(e) => set(i, { credit: e.target.value, changed: false })} />
              <div className="sel">
                <select value={r.team} onChange={(e) => set(i, { team: e.target.value })}>{teams.map((t) => <option key={t}>{t}</option>)}</select>
                <select value={r.role} onChange={(e) => set(i, { role: e.target.value })}>{ROLES.map((x) => <option key={x}>{x}</option>)}</select>
              </div>
              {(r.changed || r.prev_credit != null) && r.prev_credit != null && <div className="sub" style={{ gridColumn: '1 / -1' }}>was {r.prev_credit}</div>}
              <button className="btn sm ghost danger" style={{ gridColumn: '1 / -1', justifySelf: 'start' }} onClick={() => { setRows(rows.filter((_, j) => j !== i)); setSaved(false); }}>Remove</button>
            </div>
          ))}
          <button className="btn primary block" style={{ marginTop: 10 }} onClick={confirm} disabled={!!busy}>
            {saved ? `✓ Confirmed (${rows.length} players)` : `Confirm ${rows.length} players`}
          </button>
        </div>
      )}
    </div>
  );
}
