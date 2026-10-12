'use client';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, ApiError, imageToPayload } from '@/frontend/api';
import { Banner, Spinner, short } from './ui';
import { nameKey } from '@/shared/names';
import { ROLES } from '@/shared/types';
import { countsByTeam, defaultXI, readiness, XI_SIZE } from '@/shared/squad';

export interface SquadRow { name: string; team: string; role: string; credit: number | string; inXI: boolean; prev?: number | null; assumed?: boolean }
type Source = { title: string; uri: string };
type Step = { label: string; state: 'todo' | 'doing' | 'done' };

const STEPS = ['Saving your squad', 'Reading the pitch and conditions', 'Pulling each player’s fantasy history', 'Building the best valid XI'];

/**
 * One table for the whole "who is playing" job: upload a screenshot, tick the XI right in the player list,
 * press Build. Credits are optional and hidden until needed.
 */
export default function SquadEditor({ matchId, teams, initial, confirmedInitial, hasContext, canFetchToss, hasTeam }: { matchId: string; teams: [string, string]; initial: SquadRow[]; confirmedInitial: boolean; hasContext: boolean; canFetchToss: boolean; hasTeam: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState<SquadRow[]>(initial);
  const [confirmed, setConfirmed] = useState(confirmedInitial);
  const [showCredits, setShowCredits] = useState(initial.some((r) => Number(r.credit) > 0));
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState<{ kind: 'ok' | 'warn' | ''; text: string; sources?: Source[] } | null>(null);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const ready = readiness(rows, teams);
  const [ca, cb] = countsByTeam(rows, teams);
  const set = (i: number, patch: Partial<SquadRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const creditsKnown = rows.length > 0 && rows.every((r) => Number(r.credit) > 0);
  const payloadRows = () => rows.filter((r) => r.name.trim()).map((r) => ({ name: r.name.trim(), team: r.team, role: r.role, credit: showCredits && Number(r.credit) > 0 ? Number(r.credit) : '' }));
  const saveCredits = () => api(`/api/matches/${matchId}/credits`, { method: 'PUT', json: { rows: payloadRows(), skipCredits: !(showCredits && creditsKnown) } });
  const xiBody = (extra: object = {}) => ({
    teamA: rows.filter((r) => r.team === teams[0] && r.inXI).map((r) => nameKey(r.name)),
    teamB: rows.filter((r) => r.team === teams[1] && r.inXI).map((r) => nameKey(r.name)),
    impact: [], confirmed, source: confirmed ? 'manual' : 'probable', ...extra,
  });

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy('Reading your screenshots…'); setErr(''); setNote(null);
    try {
      const images = await Promise.all([...files].slice(0, 3).map((f) => imageToPayload(f)));
      const { rows: out } = await api(`/api/matches/${matchId}/credits/extract`, { method: 'POST', json: { images } });
      const have = new Set(rows.map((r) => nameKey(r.name)));
      const fresh = out.filter((r: any) => !have.has(nameKey(r.name)));
      const sel = defaultXI(fresh, teams);
      const added: SquadRow[] = fresh.map((r: any, i: number) => ({ name: r.name, team: r.team, role: r.role, credit: r.credit, inXI: sel[i], prev: r.prev_credit, assumed: r.assumed }));
      setRows((rs) => [...rs, ...added]);
      if (out.some((r: any) => typeof r.credit === 'number' && !r.assumed)) setShowCredits(true);
      const picked = added.filter((r) => r.inXI).length;
      setNote({ kind: picked ? 'ok' : 'warn', text: picked ? `Found ${fresh.length} players. I ticked ${picked} as the probable XI, using the "Played Last Match" list on your screenshot. Check it, then build.` : `Found ${fresh.length} players, but the screenshot doesn't show a clear probable XI. Tick the players who are playing.` });
    } catch (e: any) { setErr(`${e.message} You can add the players by hand instead.`); }
    setBusy('');
    if (file.current) file.current.value = '';
  }

  async function loadKnown() {
    setBusy('Loading the squad…'); setErr('');
    try {
      const { rows: r, apiSquad } = await api(`/api/matches/${matchId}/credits`);
      const have = new Set(rows.map((x) => nameKey(x.name)));
      const add: SquadRow[] = r.filter((x: any) => !have.has(nameKey(x.name))).map((x: any) => ({ name: x.name, team: x.team, role: x.role, credit: x.credit, inXI: false }));
      setRows((rs) => [...rs, ...add]);
      setNote(add.length ? { kind: 'ok', text: `Loaded ${add.length} players${apiSquad ? ` (${apiSquad} from the cricket API)` : ''}. Tick who is playing.` } : { kind: 'warn', text: 'No squad or earlier players found for these teams. Upload a screenshot or add players by hand.' });
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  async function findXI() {
    if (rows.filter((r) => r.name.trim()).length < XI_SIZE) { setErr('Add the players first, then I can look for the announced XI.'); return; }
    setErr(''); setNote(null);
    try {
      setBusy('Saving the squad…'); await saveCredits();
      if (canFetchToss) { setBusy('Checking the toss…'); try { await api(`/api/matches/${matchId}/xi`, { method: 'POST' }); } catch { /* toss is optional */ } }
      setBusy('Looking for the announced playing XI…');
      const r = await api(`/api/matches/${matchId}/xi/lookup`, { method: 'POST' });
      if (r.announced) {
        const keys = new Set<string>([...r.teamA, ...r.teamB, ...r.impact]);
        setRows((rs) => rs.map((x) => ({ ...x, inXI: keys.has(nameKey(x.name)) })));
        setConfirmed(true);
        setNote({ kind: 'ok', text: `Announced XI found and ticked. It comes from a web search, so check it against Dream11.${r.unmatched.length ? ` Not in your list: ${r.unmatched.join(', ')}.` : ''}`, sources: r.sources });
      } else {
        setConfirmed(false);
        setNote({ kind: 'warn', text: `Team announcement is not yet done. Tick the probable playing 11 to make the fantasy team, then rebuild once the XI is announced.${r.note ? ` (${r.note})` : ''}`, sources: r.sources });
      }
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  async function applyPaste() {
    setBusy('Applying the pasted XI…'); setErr('');
    try {
      await saveCredits();
      const r = await api(`/api/matches/${matchId}/xi`, { method: 'PUT', json: xiBody({ pasted: paste }) });
      const keys = new Set<string>([...r.xi.teamA, ...r.xi.teamB, ...r.xi.impact]);
      setRows((rs) => rs.map((x) => ({ ...x, inXI: keys.has(nameKey(x.name)) })));
      setShowPaste(false);
      setNote({ kind: r.unmatched.length ? 'warn' : 'ok', text: r.unmatched.length ? `Couldn’t match: ${r.unmatched.join(', ')}. Tick them in the list.` : 'Pasted XI applied.' });
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  async function build(force = false) {
    setErr('');
    const mark = (n: number): Step[] => STEPS.map((label, i) => ({ label, state: i < n ? 'done' : i === n ? 'doing' : 'todo' }));
    try {
      setSteps(mark(0));
      await saveCredits();
      await api(`/api/matches/${matchId}/xi`, { method: 'PUT', json: xiBody() });
      setSteps(mark(1));
      if (!hasContext) await api(`/api/matches/${matchId}/context`, { method: 'POST' });
      setSteps(mark(2));
      await api(`/api/matches/${matchId}/predict`, { method: 'POST' });
      setSteps(mark(3));
      await api(`/api/matches/${matchId}/build${force ? '?force=1' : ''}`, { method: 'POST' });
      setSteps(STEPS.map((label) => ({ label, state: 'done' })));
      router.push(`/match/${matchId}/team`);
    } catch (e) {
      const er = e as ApiError;
      setSteps(null);
      if (er.data?.needsForce && confirm(`${er.message} Continue?`)) return build(true);
      setErr(er.data?.gaps?.length ? er.data.gaps.map((g: any) => g.message).join(' ') : er.message);
    }
  }

  const grouped = teams.map((t) => ({ team: t, items: rows.map((r, i) => ({ r, i })).filter((x) => x.r.team === t) }));
  const building = !!steps;

  return (
    <div>
      <div className="sq-actions">
        <input ref={file} type="file" accept="image/*" multiple hidden onChange={(e) => onFiles(e.target.files)} />
        <button className="btn primary wide" onClick={() => file.current?.click()} disabled={!!busy || building}>📷 Upload Dream11 screenshot</button>
        <button className="btn" onClick={findXI} disabled={!!busy || building}>Find announced XI</button>
        <button className="btn ghost" onClick={loadKnown} disabled={!!busy || building}>Load squad</button>
        <button className="btn ghost wide" onClick={() => setShowPaste(!showPaste)}>Paste the XI as text</button>
      </div>
      {busy && <p className="sub"><Spinner /> {busy}</p>}
      {err && <Banner kind="bad">{err}</Banner>}
      {note && (
        <Banner kind={note.kind}>
          {note.text}
          {note.sources && note.sources.length > 0 && <div className="sub" style={{ marginTop: 4 }}>Sources: {note.sources.slice(0, 4).map((s, i) => (<a key={i} href={s.uri} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', marginRight: 8 }}>{s.title || 'source'}</a>))}</div>}
        </Banner>
      )}
      {showPaste && (
        <div className="stack" style={{ margin: '10px 0' }}>
          <textarea rows={6} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={`One name per line (initials are fine).`} />
          <button className="btn block" disabled={!paste.trim() || !!busy} onClick={applyPaste}>Apply pasted XI</button>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="empty">
          <div style={{ fontSize: 34 }}>📋</div>
          <b>Start with your Dream11 screenshot</b>
          <p className="sub" style={{ margin: '4px 0 0' }}>Open Create Team for this match, screenshot the player list, and upload it. I read every player, role and the probable XI for you.</p>
        </div>
      ) : (
        <>
          <label className="row sub" style={{ gap: 8, margin: '12px 0 4px' }}>
            <input type="checkbox" checked={showCredits} onChange={(e) => setShowCredits(e.target.checked)} />
            Add credits <span>(optional: only needed to enforce the 100-credit cap)</span>
          </label>
          {grouped.map(({ team, items }) => (
            <div key={team} className="sq-team">
              <div className="row sb">
                <b>{team}</b>
                <span className={`pill ${items.filter((x) => x.r.inXI).length === XI_SIZE ? 'ok' : 'warn'}`}>{items.filter((x) => x.r.inXI).length} in XI</span>
              </div>
              {items.map(({ r, i }) => (
                <div key={i} className={`sq-row ${r.inXI ? 'on' : ''}`}>
                  <input type="checkbox" className="sq-tick" checked={r.inXI} onChange={(e) => set(i, { inXI: e.target.checked })} aria-label={`${r.name} in XI`} />
                  <input type="text" value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Player name" />
                  <select value={r.role} onChange={(e) => set(i, { role: e.target.value })}>{ROLES.map((x) => <option key={x}>{x}</option>)}</select>
                  {showCredits && <input type="number" step="0.5" inputMode="decimal" className="sq-cr" value={Number(r.credit) === 0 ? '' : r.credit} placeholder="Cr" onChange={(e) => set(i, { credit: e.target.value, assumed: false })} />}
                  <button className="sq-x" aria-label="Remove" onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              <button className="btn sm ghost" style={{ marginTop: 6 }} onClick={() => setRows((rs) => [...rs, { name: '', team, role: 'BAT', credit: '', inXI: false }])}>+ Add a {team} player</button>
            </div>
          ))}
        </>
      )}

      <div className="buildbar">
        <div className="grow">
          {building && <div className="row" style={{ gap: 8, fontWeight: 700 }}><Spinner /> {steps!.find((x) => x.state === 'doing')?.label ?? 'Almost there…'}</div>}
          {!building && <div className="row" style={{ gap: 10 }}>
            <span className="d-code">{short(teams[0])}</span><b className="num">{ca}</b>
            <span className="vs">·</span>
            <span className="d-code b">{short(teams[1])}</span><b className="num">{cb}</b>
          </div>}
          {!building && <label className="sub row" style={{ gap: 6, marginTop: 4 }}>
            <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> Confirmed XI (after the toss)
          </label>}
        </div>
        <button className="btn primary" disabled={!ready.ok || !!busy || building} onClick={() => build()}>{building ? <><Spinner /> Building…</> : hasTeam ? 'Rebuild team' : 'Build my team'}</button>
      </div>
      {rows.length > 0 && <p className={`sub ${ready.level === 'bad' ? 'bad-text' : ''}`} style={{ marginTop: 8 }}>{ready.message}{!confirmed && ready.ok ? ' (pre-toss: built on a probable XI)' : ''}</p>}
      {building && (
        <div className="card" style={{ marginTop: 8 }}>
          {steps!.map((s) => (
            <div key={s.label} className="row" style={{ padding: '4px 0', opacity: s.state === 'todo' ? 0.45 : 1 }}>
              <span className={`dot ${s.state === 'done' ? 'done' : ''}`}>{s.state === 'done' ? '✓' : s.state === 'doing' ? <Spinner /> : ''}</span>
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
