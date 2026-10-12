'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api, ApiError, fmtDate } from '@/frontend/api';
import { Banner, Spinner } from '@/frontend/components/ui';
import CreditsEditor from '@/frontend/components/CreditsEditor';
import XIEditor from '@/frontend/components/XIEditor';

export default function MatchSetup() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [ctxBusy, setCtxBusy] = useState(false);
  const [run, setRun] = useState<{ step: string; error?: string; gaps?: { message: string }[] } | null>(null);

  const load = useCallback(() => api(`/api/matches/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  if (err && !d) return <Banner kind="bad">{err}</Banner>;
  if (!d) return <p className="sub" style={{ marginTop: 30 }}><Spinner /> Loading…</p>;
  const m = d.match;
  const xi = m.xi;
  const xiCount = xi ? new Set([...xi.teamA, ...xi.teamB]).size : 0;
  const ctx = m.context;
  const creditsOk = d.credits.length >= 11;
  const final = xi?.confirmed;

  async function setContest(c: 'small' | 'grand') {
    setD({ ...d, match: { ...m, contest_type: c } });
    await api(`/api/matches/${id}`, { method: 'PATCH', json: { contest_type: c } });
  }

  async function fetchContext(force = false) {
    setCtxBusy(true);
    try { await api(`/api/matches/${id}/context${force ? '?force=1' : ''}`, { method: 'POST' }); await load(); } catch (e: any) { setErr(e.message); }
    setCtxBusy(false);
  }

  async function build(force = false) {
    setRun({ step: 'Checking inputs…' });
    try {
      if (!ctx) { setRun({ step: 'Researching pitch, weather and team news…' }); await api(`/api/matches/${id}/context`, { method: 'POST' }); }
      setRun({ step: 'Pulling each player’s fantasy history and estimating expected points…' });
      await api(`/api/matches/${id}/predict`, { method: 'POST' });
      setRun({ step: 'Building the best valid XI and picking C/VC…' });
      await api(`/api/matches/${id}/build${force ? '?force=1' : ''}`, { method: 'POST' });
      router.push(`/match/${id}/team`);
    } catch (e) {
      const er = e as ApiError;
      if (er.data?.needsForce && confirm(er.message + ' Continue?')) return build(true);
      setRun({ step: '', error: er.message, gaps: er.data?.gaps });
    }
  }

  const steps = [
    { n: 1, label: 'Contest type', done: true },
    { n: 2, label: 'Credits', done: creditsOk },
    { n: 3, label: 'Playing XI', done: xiCount >= 11 },
    { n: 4, label: 'Conditions', done: !!ctx },
  ];

  return (
    <>
      <h1>{m.team_a} <span className="sub">vs</span> {m.team_b}</h1>
      <p className="sub">{fmtDate(m.starts_at)}{m.venue ? ` · ${m.venue}` : ''} · {m.format}</p>
      {err && <Banner kind="bad">{err}</Banner>}

      <div className="row" style={{ margin: '12px 0', flexWrap: 'wrap', gap: 14 }}>
        {steps.map((s) => (<div key={s.n} className="step"><span className={`dot ${s.done ? 'done' : ''}`}>{s.done ? '✓' : s.n}</span><span className="sub" style={{ color: s.done ? 'var(--text)' : undefined }}>{s.label}</span></div>))}
      </div>

      {d.decision && (
        <Link href={`/match/${id}/team`} className="card row sb" style={{ borderColor: 'var(--accent)' }}>
          <div><b>Your team is ready</b><div className="sub">{d.decision.status === 'final' ? 'Finalised' : 'Draft'} · {d.decision.stage === 'pre_toss' ? 'pre-toss, probable XI' : 'confirmed XI'}</div></div>
          <span className="btn sm">Open →</span>
        </Link>
      )}

      <h2>1 · Contest</h2>
      <div className="seg">
        <button className={m.contest_type === 'small' ? 'on' : ''} onClick={() => setContest('small')}>Small league</button>
        <button className={m.contest_type === 'grand' ? 'on' : ''} onClick={() => setContest('grand')}>Grand league</button>
      </div>
      <p className="sub">{m.contest_type === 'small' ? 'Safe, high-floor captain choice.' : 'Differential captain picks allowed.'}</p>

      <h2>2 · Credits from Dream11</h2>
      <div className="card">
        <CreditsEditor matchId={id} teams={[m.team_a, m.team_b]} initial={d.credits.map((c: any) => ({ name: c.name, team: c.team, role: c.role, credit: Number(c.credit) }))} onSaved={load} />
      </div>

      <h2>3 · Playing XI</h2>
      <div className="card">
        {xi && <p style={{ marginTop: 0 }}><span className={`pill ${final ? 'ok' : 'warn'}`}>{final ? 'Confirmed XI' : 'Probable XI · pre-toss'}</span></p>}
        <XIEditor key={d.credits.length} matchId={id} teamA={m.team_a} teamB={m.team_b} players={d.credits} initial={xi} toss={m.toss} isManual={id.startsWith('manual-') || id.startsWith('rb-')} onSaved={load} />
      </div>

      <h2>4 · Pitch & conditions</h2>
      <div className="card stack">
        {ctx ? (
          <>
            <div className="row sb"><span className="pill">{String(ctx.pitch_type).replace(/_/g, ' ')}</span><span className="sub">via Google Search</span></div>
            {[['Pitch', ctx.pitch_report], ['Surface', ctx.surface], ['Weather', ctx.weather], ['Dew', ctx.dew], ['Team news', ctx.team_news], ['Venue record', ctx.venue_stats]].map(([k, v]) => (
              <div key={k}><div className="sub">{k}</div><div>{v}</div></div>
            ))}
            {ctx.sources?.length > 0 && <div className="sub">Sources: {ctx.sources.slice(0, 6).map((s: any, i: number) => (<a key={i} href={s.uri} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', marginRight: 8 }}>{s.title || new URL(s.uri).hostname}</a>))}</div>}
          </>
        ) : <p className="sub" style={{ margin: 0 }}>Not fetched yet. It runs automatically when you build.</p>}
        <button className="btn" onClick={() => fetchContext(!!ctx)} disabled={ctxBusy}>{ctxBusy ? <Spinner /> : ctx ? 'Refresh conditions' : 'Fetch conditions'}</button>
      </div>

      <h2>5 · Build</h2>
      {!final && xiCount >= 11 && <Banner>This will be a <b>pre-toss run on a probable XI</b>. Re-run after the toss.</Banner>}
      {xiCount < 11 && <Banner>Save the XI (or probable XI) to continue.</Banner>}
      {run?.error && (
        <Banner kind="bad"><b>Can’t build yet.</b> {run.gaps?.length ? run.gaps.map((g) => <div key={g.message}>• {g.message}</div>) : run.error}</Banner>
      )}
      <button className="btn primary block" disabled={!creditsOk || xiCount < 11 || (!!run && !run.error)} onClick={() => build()}>
        {run && !run.error ? <><Spinner /> {run.step}</> : d.decision ? 'Rebuild team' : final ? 'Build my team' : 'Build pre-toss team'}
      </button>
    </>
  );
}
