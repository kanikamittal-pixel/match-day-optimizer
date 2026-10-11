'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, fmtDate } from '@/client/api';
import { Banner, Spinner } from '@/client/components/ui';

interface M { id: string; name: string; team_a: string; team_b: string; venue: string | null; format: string; starts_at: string | null; has_team: boolean; team_status: string | null; results_in: boolean }

export default function Home() {
  const [data, setData] = useState<{ matches: M[]; awaiting: { id: string; name: string }[]; usage: { hits: number; limit: number }; apiNote: string | null } | null>(null);
  const [err, setErr] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ team_a: '', team_b: '', venue: '', format: 'T20' });

  const load = (refresh = false) => api(`/api/matches${refresh ? '?refresh=1' : ''}`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  async function addManual() {
    try {
      const { id } = await api('/api/matches', { method: 'POST', json: form });
      window.location.href = `/match/${id}`;
    } catch (e: any) { setErr(e.message); }
  }

  if (err && !data) return <Banner kind="bad">{err}</Banner>;
  if (!data) return <p className="sub" style={{ marginTop: 30 }}><Spinner /> Loading matches…</p>;

  return (
    <>
      <h1>Today & upcoming</h1>
      <p className="sub">Pick a match. A researched, valid team takes about five minutes.</p>

      {data.awaiting.length > 0 && (
        <div className="banner warn">
          <b>Waiting for results ({data.awaiting.length})</b>
          {data.awaiting.map((a) => (
            <Link key={a.id} href={`/match/${a.id}/result`} style={{ display: 'block', marginTop: 6, textDecoration: 'underline' }}>
              {a.name}: enter points (under 2 min)
            </Link>
          ))}
        </div>
      )}
      {data.apiNote && <Banner kind="warn">{data.apiNote}</Banner>}
      {err && <Banner kind="bad">{err}</Banner>}

      <div style={{ marginTop: 12 }}>
        {data.matches.map((m) => (
          <Link key={m.id} href={m.results_in ? `/match/${m.id}/team` : `/match/${m.id}`} className="card match" style={{ display: 'block' }}>
            <div className="row sb">
              <div className="t">{m.team_a} <span className="sub">vs</span> {m.team_b}</div>
              <span className="pill">{m.format}</span>
            </div>
            <div className="sub" style={{ marginTop: 4 }}>{fmtDate(m.starts_at)}{m.venue ? ` · ${m.venue}` : ''}</div>
            <div className="row" style={{ marginTop: 8 }}>
              {m.results_in ? <span className="pill ok">Results in</span> : m.team_status === 'final' ? <span className="pill ok">Team final</span> : m.has_team ? <span className="pill warn">Draft team</span> : <span className="pill">Not started</span>}
            </div>
          </Link>
        ))}
        {!data.matches.length && <p className="sub">No matches found. Add one manually below.</p>}
      </div>

      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn sm" onClick={() => load(true)}>Refresh fixtures</button>
        <button className="btn sm ghost" onClick={() => setAdding(!adding)}>+ Add a match manually</button>
        <span className="sub" style={{ marginLeft: 'auto' }}>API {data.usage.hits}/{data.usage.limit} today</span>
      </div>

      {adding && (
        <div className="card stack" style={{ marginTop: 12 }}>
          <div className="row"><input type="text" placeholder="Team A" value={form.team_a} onChange={(e) => setForm({ ...form, team_a: e.target.value })} /><input type="text" placeholder="Team B" value={form.team_b} onChange={(e) => setForm({ ...form, team_b: e.target.value })} /></div>
          <input type="text" placeholder="Venue" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
          <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}><option>T20</option><option>ODI</option><option>TEST</option></select>
          <button className="btn primary block" disabled={!form.team_a || !form.team_b} onClick={addManual}>Create match</button>
        </div>
      )}
    </>
  );
}
