'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/frontend/api';
import { Banner, Spinner, short } from '@/frontend/components/ui';

export default function Results() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [note, setNote] = useState<{ kind: 'ok' | 'warn'; text: string } | null>(null);

  useEffect(() => {
    api(`/api/matches/${id}/results`).then((r) => { setD(r); const init = Object.fromEntries(r.players.map((p: any) => [p.key, p.points ?? ''])); setVals(init); if (r.started && new URLSearchParams(window.location.search).get('fetch') === '1' && r.players.every((p: any) => p.points === null)) fetchResults(r, init); }).catch((e) => setErr(e.message));
  }, [id]);

  async function fetchResults(current?: any, currentVals?: Record<string, string>) {
    setFetching(true); setErr(''); setNote(null);
    try {
      const r = await api(`/api/matches/${id}/results/fetch`, { method: 'POST' });
      const base = currentVals ?? vals;
      const next = { ...base };
      for (const [k, v] of Object.entries(r.points)) next[k] = String(v);
      setVals(next);
      const list = (current ?? d).players;
      const missing = list.filter((p: any) => !(p.key in r.points)).length;
      setNote({
        kind: r.final && !missing ? 'ok' : 'warn',
        text: `Fetched ${r.matched} of ${list.length} players from the scorecard${r.final ? '' : ' (match not finished yet, so these are provisional)'}. These are estimates from the scoring weights, so Dream11's official numbers can differ slightly. ${missing ? `${missing} player(s) weren’t in the scorecard (didn’t bat, bowl or field, or the name didn’t match): enter them by hand. ` : ''}Check, then save.`,
      });
    } catch (e: any) { setErr(e.message); }
    setFetching(false);
  }

  const total = useMemo(() => {
    if (!d) return 0;
    return d.players.filter((p: any) => p.in_final).reduce((s: number, p: any) => {
      const v = Number(vals[p.key]); if (!Number.isFinite(v) || vals[p.key] === '') return s;
      return s + v * (p.key === d.captain ? 2 : p.key === d.vc ? 1.5 : 1);
    }, 0);
  }, [d, vals]);

  async function save() {
    setBusy(true); setErr('');
    try {
      await api(`/api/matches/${id}/results`, { method: 'PUT', json: { points: d.players.map((p: any) => ({ key: p.key, points: vals[p.key] === '' ? null : Number(vals[p.key]) })) } });
      router.push('/insights');
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  if (err && !d) return <Banner kind="bad">{err}</Banner>;
  if (!d) return <p className="sub" style={{ marginTop: 30 }}><Spinner /> Loading…</p>;
  const locked = !d.started; // the match has not started: nothing can be fetched or entered
  const filled = d.players.filter((p: any) => vals[p.key] !== '').length;
  const finals = d.players.filter((p: any) => p.in_final);
  const dropped = d.players.filter((p: any) => !p.in_final);

  const Row = (p: any) => (
    <div key={p.key} className="row" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
      <div className="grow">
        <b>{p.name}</b> {p.key === d.captain && <span className="badge-c">C</span>} {p.key === d.vc && <span className="badge-vc">VC</span>}
        <div className="sub">{p.role} · {short(p.team)} · predicted <span className="num">{p.xp}</span></div>
      </div>
      <input type="number" inputMode="decimal" step="0.5" disabled={locked} style={{ width: 88, textAlign: 'right' }} placeholder="pts" value={vals[p.key] ?? ''} onChange={(e) => setVals({ ...vals, [p.key]: e.target.value })} />
    </div>
  );

  return (
    <>
      <Link href={`/match/${id}/team`} className="sub" style={{ display: 'block', marginTop: 18 }}>← Team</Link>
      <h1>Match results</h1>
      {locked ? (
        <Banner kind="warn"><b>This match has not started yet.</b> It begins {new Date(d.startsAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}. Points can be fetched or entered once it has started; until then there is nothing to record.</Banner>
      ) : (
        <p className="sub">Fetch the points from the scorecard, or type each player’s actual Dream11 points (before C/VC multipliers).</p>
      )}
      <button className="btn primary block" onClick={() => fetchResults()} disabled={fetching || locked}>{fetching ? <><Spinner /> Fetching the scorecard…</> : 'Fetch match results'}</button>
      {note && <Banner kind={note.kind === 'ok' ? 'ok' : 'warn'}>{note.text}</Banner>}
      {err && <Banner kind="bad">{err}</Banner>}
      <h2>Your final XI</h2>
      <div className="card flat">{finals.map(Row)}</div>
      {dropped.length > 0 && (<><h2>Agent picks you dropped</h2><p className="sub">Needed to compare both judgements fairly.</p><div className="card flat">{dropped.map(Row)}</div></>)}
      <div style={{ position: 'sticky', bottom: 12, marginTop: 16 }}>
        <button className="btn primary block" disabled={busy || filled === 0 || locked} onClick={save}>{busy ? <Spinner /> : <>Save {filled}/{d.players.length} · your team <span className="num">{total.toFixed(1)}</span> pts</>}</button>
      </div>
    </>
  );
}
