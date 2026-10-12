'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/frontend/api';
import { Banner, Spinner, short } from '@/frontend/components/ui';
import { countdown, dayLabel } from '@/shared/when';

interface M { id: string; name: string; team_a: string; team_b: string; venue: string | null; format: string; starts_at: string | null; status: string | null; phase: 'completed' | 'live' | 'upcoming'; has_team: boolean; team_status: string | null; results_in: boolean }
interface Status { history: { rows: number; latest: string | null }; weights: { version: number | null }; cricketdata: { hits: number; limit: number }; rapid: { hits: number; limit: number } }
type Filter = 'upcoming' | 'today' | 'result' | 'all';

const timeOf = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : '');

export default function Dashboard() {
  const [data, setData] = useState<{ matches: M[]; awaiting: { id: string; name: string }[]; apiNote: string | null } | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState<Filter>('upcoming');
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ team_a: '', team_b: '', venue: '', format: 'T20' });
  const [, tick] = useState(0);

  const load = (refresh = false) => api(`/api/matches${refresh ? '?refresh=1' : ''}`).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); api('/api/status').then(setStatus).catch(() => {}); const t = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(t); }, []);

  const matches = data?.matches ?? [];
  const next = useMemo(() => matches.filter((m) => m.phase !== 'completed' && !m.results_in).sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)))[0], [matches]);

  const shown = useMemo(() => {
    const now = new Date();
    const text = q.trim().toLowerCase();
    return matches
      .filter((m) => !text || `${m.team_a} ${m.team_b} ${m.venue ?? ''}`.toLowerCase().includes(text))
      .filter((m) => filter === 'all' ? true : filter === 'today' ? dayLabel(m.starts_at, now) === 'Today' : filter === 'result' ? data?.awaiting.some((a) => a.id === m.id) : m.phase !== 'completed')
      .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  }, [matches, filter, q, data]);

  const groups = useMemo(() => {
    const g = new Map<string, M[]>();
    for (const m of shown) g.set(dayLabel(m.starts_at), [...(g.get(dayLabel(m.starts_at)) ?? []), m]);
    return [...g];
  }, [shown]);

  async function addManual() {
    try { const { id } = await api('/api/matches', { method: 'POST', json: form }); window.location.href = `/match/${id}`; } catch (e: any) { setErr(e.message); }
  }

  if (err && !data) return <Banner kind="bad">{err}</Banner>;
  if (!data) return <p className="sub" style={{ marginTop: 30 }}><Spinner /> Loading your dashboard…</p>;

  const built = matches.filter((m) => m.has_team).length;
  const awaiting = data.awaiting.length;

  return (
    <>
      {awaiting > 0 && (
        <div className="banner warn" style={{ marginTop: 14 }}>
          <b>{awaiting} match{awaiting === 1 ? '' : 'es'} waiting for results</b>
          {data.awaiting.map((a) => <Link key={a.id} href={`/match/${a.id}/result?fetch=1`} style={{ display: 'block', marginTop: 6, textDecoration: 'underline' }}>{a.name}: fetch the result</Link>)}
        </div>
      )}
      {data.apiNote && <Banner kind="warn">{data.apiNote}</Banner>}
      {err && <Banner kind="bad">{err}</Banner>}

      <div className="dash">
        <section className="hero">
          <div className="eyebrow">{next ? (next.phase === 'live' ? 'In progress' : 'Next match') : 'No upcoming match'}</div>
          {next ? (
            <>
              <div className="row" style={{ gap: 10, marginTop: 10 }}>
                <span className="d-code lg">{short(next.team_a)}</span><b className="vs">VS</b><span className="d-code lg b">{short(next.team_b)}</span>
                <span className="pill" style={{ marginLeft: 'auto' }}>{next.format}</span>
              </div>
              <h1 className="hero-title">{next.team_a} vs {next.team_b}</h1>
              <div className="sub">{dayLabel(next.starts_at)} {timeOf(next.starts_at)}{next.venue ? ` · ${next.venue}` : ''}</div>
              <div className="countdown">{countdown(next.starts_at)}</div>
              <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: 'wrap' }}>
                {next.has_team
                  ? <><Link href={`/match/${next.id}/team`} className="btn primary grow">Open my team</Link><Link href={`/match/${next.id}`} className="btn">Rebuild</Link></>
                  : <Link href={`/match/${next.id}`} className="btn primary grow">Build my team →</Link>}
              </div>
              <p className="sub" style={{ margin: '10px 0 0' }}>Upload your Dream11 screenshot, check the XI, tap Build. About two minutes.</p>
            </>
          ) : (
            <>
              <h1 className="hero-title">Nothing to build right now</h1>
              <p className="sub">The feeds list no upcoming T20 or ODI. Add a match you can see in Dream11 below.</p>
              <button className="btn primary" onClick={() => setAdding(true)}>+ Add a match</button>
            </>
          )}
        </section>

        <section className="tiles">
          <div className="tile"><div className="k">Teams built</div><div className="v num">{built}</div><div className="s">across {matches.length} listed matches</div></div>
          <Link href={awaiting ? `/match/${data.awaiting[0].id}/result?fetch=1` : '#'} className="tile"><div className="k">Waiting for results</div><div className="v num" style={{ color: awaiting ? 'var(--amber)' : undefined }}>{awaiting}</div><div className="s">{awaiting ? 'tap to fetch the first' : 'all caught up'}</div></Link>
          <div className="tile"><div className="k">Fantasy history</div><div className="v num">{status ? (status.history.rows >= 1000 ? `${Math.round(status.history.rows / 1000)}k` : status.history.rows) : '…'}</div><div className="s">{status?.history.latest ? `player-matches · through ${new Date(status.history.latest).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : 'player-matches'}</div></div>
          <Link href="/settings" className="tile"><div className="k">Scoring rules</div><div className="v num">v{status?.weights.version ?? '…'}</div><div className="s">Dream11 T20 table · {status?.weights.version === 2 ? 'current' : 'older version'}</div></Link>
        </section>
      </div>

      <div className="row sb" style={{ marginTop: 22 }}>
        <h2 style={{ margin: 0 }}>Matches</h2>
        <button className="btn sm ghost" onClick={() => load(true)}>↻ Refresh</button>
      </div>
      <input className="search" type="text" placeholder="Search a team or ground…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips" style={{ margin: '10px 0' }}>
        {([['upcoming', 'Upcoming'], ['today', 'Today'], ['result', `Needs result${awaiting ? ` (${awaiting})` : ''}`], ['all', 'All']] as [Filter, string][]).map(([k, label]) => (
          <span key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label}</span>
        ))}
      </div>

      {groups.length === 0 && <p className="sub">No matches here. {filter !== 'all' && <a style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => { setFilter('all'); setQ(''); }}>Show all</a>}</p>}
      {groups.map(([label, list]) => (
        <div key={label}>
          <div className="daylabel">{label}</div>
          {list.map((m) => (
            <Link key={m.id} href={m.results_in ? `/match/${m.id}/team` : `/match/${m.id}`} className="mrow">
              <div className="mtime num">{timeOf(m.starts_at) || '—'}</div>
              <div className="grow">
                <div className="row" style={{ gap: 6 }}><span className="d-code sm">{short(m.team_a)}</span><span className="vs">v</span><span className="d-code sm b">{short(m.team_b)}</span><span className="pill">{m.format}</span></div>
                <div className="sub" style={{ marginTop: 3 }}>{m.team_a} vs {m.team_b}{m.venue ? ` · ${m.venue}` : ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                {m.results_in ? <span className="pill ok">Results in</span> : m.team_status === 'final' ? <span className="pill ok">Team final</span> : m.has_team ? <span className="pill warn">Draft</span> : m.phase === 'live' ? <span className="pill warn">In progress</span> : m.phase === 'completed' ? <span className="pill">Finished</span> : <span className="pill accent">Build →</span>}
              </div>
            </Link>
          ))}
        </div>
      ))}

      <div className="row" style={{ marginTop: 14, flexWrap: 'wrap' }}>
        <button className="btn sm ghost" onClick={() => setAdding(!adding)}>+ Add a match manually</button>
        {status && <span className="sub" style={{ marginLeft: 'auto' }}>CricketData {status.cricketdata.hits}/{status.cricketdata.limit} today · RapidAPI {status.rapid.hits}/{status.rapid.limit} this month</span>}
      </div>
      {adding && (
        <div className="card stack" style={{ marginTop: 12 }}>
          <div className="row"><input type="text" placeholder="Team A" value={form.team_a} onChange={(e) => setForm({ ...form, team_a: e.target.value })} /><input type="text" placeholder="Team B" value={form.team_b} onChange={(e) => setForm({ ...form, team_b: e.target.value })} /></div>
          <input type="text" placeholder="Venue" value={form.venue} onChange={(e) => setForm({ ...form, venue: e.target.value })} />
          <select value={form.format} onChange={(e) => setForm({ ...form, format: e.target.value })}><option>T20</option><option>ODI</option></select>
          <button className="btn primary block" disabled={!form.team_a || !form.team_b} onClick={addManual}>Create match</button>
        </div>
      )}
    </>
  );
}
