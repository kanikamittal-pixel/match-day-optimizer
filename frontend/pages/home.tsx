'use client';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api } from '@/frontend/api';
import { Banner, short } from '@/frontend/components/ui';
import Sparkline from '@/frontend/components/Sparkline';
import FaceOff, { heat } from '@/frontend/components/FaceOff';
import { countdown, dayLabel, localDay } from '@/shared/when';

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
  const [day, setDay] = useState(''); // date filter: YYYY-MM-DD, empty = any day
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ team_a: '', team_b: '', venue: '', format: 'T20' });
  const [, tick] = useState(0);

  const [syncing, setSyncing] = useState(false);
  const [watch, setWatch] = useState<{ teams: { team: string; players: { player: string; n: number; recent: number[]; mean: number }[] }[]; note?: string } | null>(null);
  // Fast first paint from the database, then a background sync with the cricket APIs (nobody waits on those)
  const sync = (refresh = false) => { setSyncing(true); return api(`/api/matches?${refresh ? 'refresh=1' : 'sync=1'}`).then(setData).catch(() => {}).finally(() => setSyncing(false)); };
  const load = (refresh = false) => (refresh ? sync(true) : api('/api/matches').then(setData).catch((e) => setErr(e.message)));
  useEffect(() => {
    load().then(() => sync());
    api('/api/status').then(setStatus).catch(() => {});
    const t = setInterval(() => tick((n) => n + 1), 60000);
    return () => clearInterval(t);
  }, []);

  const matches = data?.matches ?? [];
  // The match the dashboard is about: the one Aryan picks below, otherwise the soonest T20 (form data exists for T20s only)
  const [pick, setPick] = useState<string | null>(null);
  const upcoming = useMemo(() => matches.filter((m) => m.phase !== 'completed' && !m.results_in).sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at))), [matches]);
  const next = upcoming.find((m) => m.id === pick) ?? upcoming.find((m) => m.format === 'T20') ?? upcoming[0];
  const nextId = next?.format === 'T20' ? next.id : undefined;
  useEffect(() => {
    setWatch(null);
    if (nextId) api(`/api/dashboard/watch?match=${encodeURIComponent(nextId)}`).then(setWatch).catch(() => {});
  }, [nextId]);

  const shown = useMemo(() => {
    const now = new Date();
    const text = q.trim().toLowerCase();
    return matches
      .filter((m) => !text || `${m.team_a} ${m.team_b} ${m.venue ?? ''}`.toLowerCase().includes(text))
      .filter((m) => (day ? localDay(m.starts_at) === day : true))
      .filter((m) => day || filter === 'all' ? true : filter === 'today' ? dayLabel(m.starts_at, now) === 'Today' : filter === 'result' ? data?.awaiting.some((a) => a.id === m.id) : m.phase !== 'completed')
      .sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  }, [matches, filter, q, day, data]);

  // days that have matches, for the date chips
  const days = useMemo(() => {
    const c = new Map<string, { n: number; iso: string }>();
    for (const m of matches) { const k = localDay(m.starts_at); if (k) c.set(k, { n: (c.get(k)?.n ?? 0) + 1, iso: m.starts_at as string }); }
    return [...c].sort((a, b) => a[0].localeCompare(b[0]));
  }, [matches]);

  const groups = useMemo(() => {
    const g = new Map<string, M[]>();
    for (const m of shown) g.set(dayLabel(m.starts_at), [...(g.get(dayLabel(m.starts_at)) ?? []), m]);
    return [...g];
  }, [shown]);

  async function addManual() {
    try { const { id } = await api('/api/matches', { method: 'POST', json: form }); window.location.href = `/match/${id}`; } catch (e: any) { setErr(e.message); }
  }

  if (err && !data) return <Banner kind="bad">{err}</Banner>;
  if (!data) return (
    <div className="dash" style={{ marginTop: 14 }}>
      <div className="hero skel" style={{ minHeight: 230 }} />
      <div className="tiles">{[0, 1, 2, 3].map((i) => <div key={i} className="tile skel" style={{ minHeight: 96 }} />)}</div>
    </div>
  );

  const built = matches.filter((m) => m.has_team).length;
  const awaiting = data.awaiting.length;

  return (
    <>
      {data.apiNote && <Banner kind="warn">{data.apiNote}</Banner>}
      {err && <Banner kind="bad">{err}</Banner>}

      <div className="dash">
        <section className="hero">
          <div className="eyebrow">{next ? (next.phase === 'live' ? 'In progress' : pick ? 'Selected match' : 'Next match') : 'No upcoming match'}</div>
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
              <p className="sub" style={{ margin: '10px 0 0' }}>I find the squads and the XI for you. Check the ticks, tap Build. About a minute.</p>
              {upcoming.length > 1 && (
                <div className="switch">
                  <div className="sub">Switch match (the form averages below follow it)</div>
                  <div className="chips" style={{ marginTop: 6 }}>
                    {upcoming.slice(0, 10).map((m) => (
                      <span key={m.id} className={`chip ${m.id === next.id ? 'on' : ''}`} onClick={() => setPick(m.id)}>{short(m.team_a)} v {short(m.team_b)} · {dayLabel(m.starts_at)} · {m.format}</span>
                    ))}
                  </div>
                </div>
              )}
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

      <div className="dash2">
        {awaiting > 0 && (
          <section className="panel todo">
            <div className="ph"><b>To do</b><span className="pill warn">{awaiting}</span></div>
            {data.awaiting.map((a) => (
              <Link key={a.id} href={`/match/${a.id}/result?fetch=1`} className="todo-row">
                <div className="grow"><b>Fetch the result</b><div className="sub">{a.name}</div></div><span className="btn sm">Fetch →</span>
              </Link>
            ))}
          </section>
        )}
        {next && next.format !== 'T20' && (
          <section className="panel watch"><div className="ph"><b>Players to watch</b></div><p className="sub" style={{ margin: 0 }}>Form averages are built from T20 history, so they are not shown for {next.format} matches. Pick a T20 above to see them.</p></section>
        )}
        {watch && watch.teams.some((t) => t.players.length) && (
          <section className="panel watch">
            <div className="ph"><b>Players to watch · {next?.team_a} v {next?.team_b}</b><span className="sub">fantasy points per match</span></div>
            <p className="sub wlegend">Each bar is one of the last 10 T20s (newest on the right): <i className="lg g" /> 90+ points, <i className="lg b" /> 40 to 89, <i className="lg m" /> under 40. The big number is their average Dream11 points per match. 🔥 last 3 matches well above that average, ❄️ well below.</p>
            <div className="watch-cols">
              {watch.teams.map((t) => (
                <div key={t.team}>
                  <div className="wteam"><span className="d-code sm">{short(t.team)}</span> {t.team}</div>
                  {t.players.length === 0 && <p className="sub" style={{ margin: '6px 0 0' }}>No T20 history on record for this side.</p>}
                  {t.players.map((p) => (
                    <div key={p.player} className="wrow">
                      <div className="grow"><div className="wname">{p.player}{heat(p) === 'hot' && <span title="Last 3 scores well above his 10-match average"> 🔥</span>}{heat(p) === 'cold' && <span title="Last 3 scores well below his 10-match average"> ❄️</span>}</div><div className="sub">{p.n} T20s in the last year</div></div>
                      <Sparkline values={p.recent} />
                      <div className="wmean"><b className="num">{p.mean}</b><span>avg pts</span></div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}
        {watch && watch.teams.some((t) => t.players.length) && <FaceOff teams={watch.teams} />}
        <section className="panel how">
          <div className="ph"><b>How it works</b><span className="sub">about 2 minutes</span></div>
          <div className="steps3">
            <div><span>1</span><b>Find</b><p>I search for both squads and the announced or most likely XI. Nothing to upload.</p></div>
            <div><span>2</span><b>Check</b><p>Tick or untick the XI in one table. Check again after the toss for the official XI.</p></div>
            <div><span>3</span><b>Build</b><p>One tap: pitch, history and a valid XI with captain, ready to copy into Dream11.</p></div>
          </div>
        </section>
      </div>

      <div className="row sb" style={{ marginTop: 22 }}>
        <h2 style={{ margin: 0 }}>Matches {syncing && <span className="sub" style={{ textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}>updating fixtures…</span>}</h2>
        <button className="btn sm ghost" onClick={() => load(true)}>↻ Refresh</button>
      </div>
      <input className="search" type="text" placeholder="Search a team or ground…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="chips" style={{ margin: '10px 0' }}>
        {([['upcoming', 'Upcoming'], ['today', 'Today'], ['result', `Needs result${awaiting ? ` (${awaiting})` : ''}`], ['all', 'All']] as [Filter, string][]).map(([k, label]) => (
          <span key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{label}</span>
        ))}
      </div>

      {days.length > 1 && (
        <div className="daybar">
          <span className="sub">Day</span>
          <div className="chips">
            {days.slice(0, 8).map(([k, v]) => (
              <span key={k} className={`chip ${day === k ? 'on' : ''}`} onClick={() => setDay(day === k ? '' : k)}>{dayLabel(v.iso)} · {v.n}</span>
            ))}
          </div>
          <input type="date" className="daypick" value={day} min={days[0][0]} max={days[days.length - 1][0]} onChange={(e) => setDay(e.target.value)} aria-label="Pick a date" />
          {day && <a className="sub" style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => setDay('')}>Any day</a>}
        </div>
      )}

      {groups.length === 0 && <p className="sub">No matches here. {(filter !== 'all' || day) && <a style={{ textDecoration: 'underline', cursor: 'pointer' }} onClick={() => { setFilter('all'); setQ(''); setDay(''); }}>Show all</a>}</p>}
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
