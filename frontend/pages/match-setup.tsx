'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, fmtDate } from '@/frontend/api';
import { Banner, Spinner, short } from '@/frontend/components/ui';
import SquadEditor, { type SquadRow } from '@/frontend/components/SquadEditor';
import { nameKey } from '@/shared/names';
import { readiness } from '@/shared/squad';

export default function MatchSetup() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [ctxBusy, setCtxBusy] = useState(false);

  const load = useCallback(() => api(`/api/matches/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (err && !d) return <Banner kind="bad">{err}</Banner>;
  if (!d) return <p className="sub" style={{ marginTop: 30 }}><Spinner /> Loading…</p>;

  const m = d.match;
  const teams: [string, string] = [m.team_a, m.team_b];
  const xi = m.xi;
  const inXI = new Set<string>([...(xi?.teamA ?? []), ...(xi?.teamB ?? []), ...(xi?.impact ?? [])]);
  const roleOrder = ['WK', 'BAT', 'AR', 'BOWL'];
  // XI first, then by role (Dream11 tab order), so the playing eleven sits together at the top of each side
  const initial: SquadRow[] = d.credits
    .map((c: any) => ({ name: c.name, team: c.team, role: c.role, credit: Number(c.credit) > 0 ? Number(c.credit) : '', inXI: inXI.has(c.name_key) }))
    .sort((a: SquadRow, b: SquadRow) => Number(b.inXI) - Number(a.inXI) || roleOrder.indexOf(a.role) - roleOrder.indexOf(b.role));
  const squadReady = readiness(initial.map((r) => ({ name: r.name, team: r.team, inXI: r.inXI })), teams).ok;
  const ctx = m.context;
  const hasTeam = !!d.decision;
  const canFetchToss = !id.startsWith('manual-') && !id.startsWith('rb-');
  const stage = hasTeam ? 3 : squadReady ? 2 : 1;

  async function setContest(c: 'small' | 'grand') {
    setD({ ...d, match: { ...m, contest_type: c } });
    await api(`/api/matches/${id}`, { method: 'PATCH', json: { contest_type: c } });
  }
  async function fetchContext(force = false) {
    setCtxBusy(true);
    try { await api(`/api/matches/${id}/context${force ? '?force=1' : ''}`, { method: 'POST' }); await load(); } catch (e: any) { setErr(e.message); }
    setCtxBusy(false);
  }

  return (
    <>
      <div className="mh">
        <div className="row" style={{ gap: 8 }}>
          <span className="d-code">{short(m.team_a)}</span><b className="vs">VS</b><span className="d-code b">{short(m.team_b)}</span>
          <span className="pill" style={{ marginLeft: 'auto' }}>{m.format}</span>
        </div>
        <h1 style={{ margin: '10px 0 2px' }}>{m.team_a} <span className="sub">vs</span> {m.team_b}</h1>
        <p className="sub" style={{ margin: 0 }}>{fmtDate(m.starts_at)}{m.venue ? ` · ${m.venue}` : ''}</p>
      </div>
      {err && <Banner kind="bad">{err}</Banner>}

      <div className="journey">
        {[['1', 'Squad & XI'], ['2', 'Build'], ['3', 'Your team']].map(([n, label], i) => (
          <div key={n} className={`j ${stage > i + 1 ? 'done' : stage === i + 1 ? 'now' : ''}`}><span>{stage > i + 1 ? '✓' : n}</span>{label}</div>
        ))}
      </div>

      {hasTeam && (
        <Link href={`/match/${id}/team`} className="card row sb" style={{ borderColor: 'var(--accent)' }}>
          <div><b>Your team is ready</b><div className="sub">{d.decision.status === 'final' ? 'Finalised' : 'Draft'} · {d.decision.stage === 'pre_toss' ? 'pre-toss, probable XI' : 'confirmed XI'}</div></div>
          <span className="btn sm primary">Open team →</span>
        </Link>
      )}

      <div className="row sb" style={{ margin: '14px 0 6px' }}>
        <h2 style={{ margin: 0 }}>Squad & playing XI</h2>
        <div className="seg compact">
          <button className={m.contest_type === 'small' ? 'on' : ''} onClick={() => setContest('small')}>Small league</button>
          <button className={m.contest_type === 'grand' ? 'on' : ''} onClick={() => setContest('grand')}>Grand league</button>
        </div>
      </div>
      <div className="card">
        <SquadEditor key={id} matchId={id} teams={teams} initial={initial} confirmedInitial={!!xi?.confirmed} hasContext={!!ctx} canFetchToss={canFetchToss} hasTeam={hasTeam} />
      </div>

      <details className="card cond">
        <summary><b>Pitch & conditions</b> <span className="sub">{ctx ? String(ctx.pitch_type).replace(/_/g, ' ') : 'fetched automatically when you build'}</span></summary>
        {ctx ? (
          <div className="stack" style={{ marginTop: 10 }}>
            {[['Pitch', ctx.pitch_report], ['Surface', ctx.surface], ['Weather', ctx.weather], ['Dew', ctx.dew], ['Team news', ctx.team_news], ['Venue record', ctx.venue_stats]].map(([k, v]) => (
              <div key={k}><div className="sub">{k}</div><div>{v}</div></div>
            ))}
            {ctx.sources?.length > 0 && <div className="sub">Sources: {ctx.sources.slice(0, 6).map((s: any, i: number) => (<a key={i} href={s.uri} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', marginRight: 8 }}>{s.title || new URL(s.uri).hostname}</a>))}</div>}
          </div>
        ) : <p className="sub" style={{ margin: '10px 0 0' }}>Not fetched yet.</p>}
        <button className="btn sm" style={{ marginTop: 10 }} onClick={() => fetchContext(!!ctx)} disabled={ctxBusy}>{ctxBusy ? <Spinner /> : ctx ? 'Refresh conditions' : 'Fetch conditions now'}</button>
      </details>
    </>
  );
}
