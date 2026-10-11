'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/client';
import { Banner, Spinner, short } from '@/components/ui';

export default function Results() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api(`/api/matches/${id}/results`).then((r) => { setD(r); setVals(Object.fromEntries(r.players.map((p: any) => [p.key, p.points ?? '']))); }).catch((e) => setErr(e.message));
  }, [id]);

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
  const filled = d.players.filter((p: any) => vals[p.key] !== '').length;
  const finals = d.players.filter((p: any) => p.in_final);
  const dropped = d.players.filter((p: any) => !p.in_final);

  const Row = (p: any) => (
    <div key={p.key} className="row" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
      <div className="grow">
        <b>{p.name}</b> {p.key === d.captain && <span className="badge-c">C</span>} {p.key === d.vc && <span className="badge-vc">VC</span>}
        <div className="sub">{p.role} · {short(p.team)} · predicted <span className="num">{p.xp}</span></div>
      </div>
      <input type="number" inputMode="decimal" step="0.5" style={{ width: 88, textAlign: 'right' }} placeholder="pts" value={vals[p.key] ?? ''} onChange={(e) => setVals({ ...vals, [p.key]: e.target.value })} />
    </div>
  );

  return (
    <>
      <Link href={`/match/${id}/team`} className="sub" style={{ display: 'block', marginTop: 18 }}>← Team</Link>
      <h1>Match results</h1>
      <p className="sub">Enter each player’s actual Dream11 points (before C/VC multipliers).</p>
      {err && <Banner kind="bad">{err}</Banner>}
      <h2>Your final XI</h2>
      <div className="card flat">{finals.map(Row)}</div>
      {dropped.length > 0 && (<><h2>Agent picks you dropped</h2><p className="sub">Needed to compare both judgements fairly.</p><div className="card flat">{dropped.map(Row)}</div></>)}
      <div style={{ position: 'sticky', bottom: 12, marginTop: 16 }}>
        <button className="btn primary block" disabled={busy || filled === 0} onClick={save}>{busy ? <Spinner /> : <>Save {filled}/{d.players.length} · your team <span className="num">{total.toFixed(1)}</span> pts</>}</button>
      </div>
    </>
  );
}
