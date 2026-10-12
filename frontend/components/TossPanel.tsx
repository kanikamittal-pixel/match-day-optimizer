'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/frontend/api';
import { Banner, Spinner } from './ui';

type Found = { announced: boolean; note?: string; sources?: { title: string; uri: string }[]; teamA?: string[]; teamB?: string[]; impact?: string[]; unmatched?: string[] };

/**
 * After the toss: fetch the announced playing XI, show who in the current team is not playing, and rebuild the team for
 * the players who are. If the XI cannot be found, Aryan ticks it by hand on the setup page.
 */
export default function TossPanel({ matchId, teamKeys, names, onDone }: { matchId: string; teamKeys: string[]; names: Record<string, string>; onDone: () => void }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  const [found, setFound] = useState<Found | null>(null);

  async function check() {
    setBusy('Checking the toss and the announced XI…'); setErr(''); setFound(null);
    try {
      try { await api(`/api/matches/${matchId}/xi`, { method: 'POST' }); } catch { /* the toss is optional */ }
      setFound(await api(`/api/matches/${matchId}/xi/lookup`, { method: 'POST' }));
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  async function rebuild() {
    if (!found?.announced) return;
    setErr('');
    try {
      setBusy('Saving the playing XI…');
      await api(`/api/matches/${matchId}/xi`, { method: 'PUT', json: { teamA: found.teamA, teamB: found.teamB, impact: found.impact ?? [], confirmed: true, source: 'announced' } });
      setBusy('Re-estimating expected points for these players…');
      await api(`/api/matches/${matchId}/predict`, { method: 'POST' });
      setBusy('Building the best valid XI…');
      await api(`/api/matches/${matchId}/build?force=1`, { method: 'POST' });
      setFound(null); onDone();
    } catch (e: any) { setErr(e.message); }
    setBusy('');
  }

  const playing = new Set([...(found?.teamA ?? []), ...(found?.teamB ?? []), ...(found?.impact ?? [])]);
  const out = found?.announced ? teamKeys.filter((k) => !playing.has(k)) : [];

  return (
    <div className="card toss">
      <b>After the toss</b>
      <p className="sub" style={{ margin: '4px 0 10px' }}>When the playing XI is out, I fetch it and rebuild the team for the players who actually play. Then you can swap anyone, as usual.</p>
      <button className="btn primary block" onClick={check} disabled={!!busy}>{busy && !found ? <><Spinner /> {busy}</> : 'Get the announced XI'}</button>
      {err && <Banner kind="bad">{err}</Banner>}
      {found && !found.announced && (
        <Banner kind="warn">The playing XI is not announced yet{found.note ? ` (${found.note})` : ''}. Try again after the toss, or <Link href={`/match/${matchId}`} style={{ textDecoration: 'underline' }}>enter the XI by hand</Link>.</Banner>
      )}
      {found?.announced && (
        <>
          <Banner kind={out.length ? 'warn' : 'ok'}>
            <b>Playing XI found.</b> {out.length ? <>Not playing from your current team: <b>{out.map((k) => names[k] ?? k).join(', ')}</b>. They will be replaced.</> : 'Everyone in your current team is playing.'}
            {found.unmatched && found.unmatched.length > 0 && <div className="sub">Not matched to the squad list: {found.unmatched.join(', ')}.</div>}
            {found.sources && found.sources.length > 0 && <div className="sub" style={{ marginTop: 4 }}>From a web search; check it against Dream11. Sources: {found.sources.slice(0, 3).map((s, i) => <a key={i} href={s.uri} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline', marginRight: 8 }}>{s.title || 'source'}</a>)}</div>}
          </Banner>
          <button className="btn primary block" onClick={rebuild} disabled={!!busy}>{busy ? <><Spinner /> {busy}</> : 'Rebuild my team for this XI'}</button>
        </>
      )}
    </div>
  );
}
