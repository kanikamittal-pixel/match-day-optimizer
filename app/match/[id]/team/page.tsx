'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/client';
import { Banner, Sheet, Spinner, short, useToast } from '@/components/ui';
import { ROLES } from '@/lib/types';
import { creditsUsed, validateTeam } from '@/lib/rules';

type Pending = { change: { kind: 'swap' | 'captain' | 'vice'; from: string; to: string }; preview: any } | null;
const WHY = ['Venue record', 'Pitch', 'Matchup', 'Team news', 'Balance'];

export default function TeamPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [sheet, setSheet] = useState<{ type: 'player' | 'swap'; key: string } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [tag, setTag] = useState<'gut' | 'reasoned'>('gut');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useToast();
  const card = useRef<HTMLDivElement>(null);

  const load = useCallback(() => api(`/api/matches/${id}`).then(setD).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { load(); }, [load]);

  const view = useMemo(() => {
    if (!d?.decision) return null;
    const preds = new Map<string, any>(d.predictions.map((p: any) => [p.name_key, p]));
    const cred = new Map<string, any>(d.credits.map((c: any) => [c.name_key, c]));
    const fin = d.decision.final;
    const rec = d.decision.recommended;
    const mk = (k: string) => ({ key: k, name: cred.get(k)?.name ?? preds.get(k)?.player_name ?? k, team: cred.get(k)?.team ?? '', role: cred.get(k)?.role ?? preds.get(k)?.role, credit: Number(cred.get(k)?.credit ?? NaN), xp: Number(preds.get(k)?.expected_points ?? 0), reason: preds.get(k)?.reason ?? '' });
    const xi = fin.xi.map(mk);
    const eligible = new Set<string>([...(d.match.xi?.teamA ?? []), ...(d.match.xi?.teamB ?? []), ...(d.match.xi?.impact ?? [])]);
    const benchAll = [...eligible].filter((k) => !fin.xi.includes(k) && preds.has(k)).map(mk).sort((a, b) => b.xp - a.xp);
    const violations = validateTeam(xi, d.rules, eligible);
    const types = new Map<string, string>();
    for (const e of d.decision.decisions) { if (e.kind === 'swap') types.set(e.to, e.tag); else types.set(`${e.kind}:${e.to}`, e.tag); }
    const benchReason = new Map<string, string>(rec.bench.map((b: any) => [b.key, b.reason]));
    return { xi, benchAll, violations, types, fin, rec, benchReason, credits: creditsUsed(xi), totalXp: Math.round(xi.reduce((s: number, p: any) => s + p.xp, 0) * 10) / 10, mk, valid: violations.length === 0 };
  }, [d]);

  if (err && !d) return <Banner kind="bad">{err}</Banner>;
  if (!d) return <p className="sub" style={{ marginTop: 30 }}><Spinner /> Loading…</p>;
  if (!view) return <><Banner>No team built yet.</Banner><Link href={`/match/${id}`} className="btn">Back to setup</Link></>;

  const { match: m, rules } = d;
  const final = d.decision.status === 'final';
  const pre = d.decision.stage === 'pre_toss';
  const left = Math.round((rules.credit_cap - view.credits) * 10) / 10;

  async function preview(change: NonNullable<Pending>['change']) {
    setBusy(true);
    try {
      const p = await api(`/api/matches/${id}/decision`, { method: 'POST', json: { action: 'preview', change } });
      setPending({ change, preview: p }); setSheet(null); setTag('gut'); setWhy('');
    } catch (e: any) { setToast(e.message); }
    setBusy(false);
  }
  async function commit(change = pending!.change, t = tag, reason = why) {
    setBusy(true);
    try { await api(`/api/matches/${id}/decision`, { method: 'POST', json: { action: 'commit', change, tag: t, reason } }); setPending(null); await load(); } catch (e: any) { setToast(e.message); }
    setBusy(false);
  }
  async function applyFix(f: any) {
    await commit(pending!.change);
    await commit({ kind: 'swap', from: f.drop_key, to: f.add_key }, 'reasoned', 'Rule fix');
  }
  async function act(action: string, msg?: string) {
    setBusy(true);
    try { await api(`/api/matches/${id}/decision`, { method: 'POST', json: { action } }); await load(); if (msg) setToast(msg); } catch (e: any) { setToast(e.message); }
    setBusy(false);
  }

  const copyText = () => {
    const lines = [`${m.team_a} vs ${m.team_b}`];
    for (const r of ROLES) {
      const ps = view.xi.filter((p: any) => p.role === r);
      if (ps.length) lines.push(`${r}: ${ps.map((p: any) => `${p.name}${p.key === view.fin.captain ? ' (C)' : p.key === view.fin.vc ? ' (VC)' : ''}`).join(', ')}`);
    }
    navigator.clipboard.writeText(lines.join('\n')).then(() => setToast('Copied for Dream11'));
  };
  const saveImage = async () => {
    if (!card.current) return;
    const { toPng } = await import('html-to-image');
    const url = await toPng(card.current, { pixelRatio: 2, backgroundColor: '#0a0f1c' });
    const a = document.createElement('a'); a.href = url; a.download = `${short(m.team_a)}-vs-${short(m.team_b)}.png`; a.click();
  };

  const tagOf = (p: any) => view.types.get(p.key) ?? view.types.get(`captain:${p.key}`) ?? view.types.get(`vice:${p.key}`) ?? 'agent';
  const cap = view.mk(view.fin.captain);
  const rec = view.rec;
  const capChanged = view.fin.captain !== rec.captain;
  const sel = sheet ? view.mk(sheet.key) : null;

  return (
    <>
      <div className="row sb" style={{ marginTop: 18 }}>
        <Link href={`/match/${id}`} className="sub">← Setup</Link>
        <div className="row">{pre && <span className="pill warn">Pre-toss · probable XI</span>}{final && <span className="pill ok">Finalised</span>}</div>
      </div>

      {pre && <Banner kind="warn"><b>Pre-toss result.</b> Built on a probable XI. Confirm the XI after the toss and rebuild before you submit.</Banner>}
      {!view.valid ? (
        <Banner kind="bad"><b>Not valid for Dream11 yet.</b> {view.violations.map((v: any) => <div key={v.message}>• {v.message}</div>)}</Banner>
      ) : (
        <Banner kind="ok"><b>Dream11-valid as shown.</b> {view.credits}/{rules.credit_cap} credits, role and team limits met.</Banner>
      )}
      {rec.cvc_source === 'fallback' && <Banner kind="warn">Captain picks fell back to the two highest expected scorers (AI pick could not be validated).</Banner>}

      <div className="teamcard" ref={card}>
        <div className="tc-head">
          <div><div className="tc-title">{m.team_a} vs {m.team_b}</div><div className="sub">{m.format} · {m.venue ?? 'Venue TBC'} · {pre ? 'PRE-TOSS' : 'FINAL XI'}</div></div>
          <span className="pill ok">{m.contest_type === 'small' ? 'Small league' : 'Grand league'}</span>
        </div>
        <div className="tc-meta">
          <div className="stat"><div className="k">Credits used</div><div className="v num">{view.credits}</div></div>
          <div className="stat"><div className="k">Credits left</div><div className="v num" style={{ color: left < 0 ? 'var(--red)' : undefined }}>{left}</div></div>
          <div className="stat"><div className="k">Expected pts</div><div className="v num">{view.totalXp}</div></div>
        </div>
        {ROLES.map((r) => {
          const ps = view.xi.filter((p: any) => p.role === r);
          if (!ps.length) return null;
          return (
            <div key={r}>
              <div className="tc-role">{r} · {ps.length}</div>
              {ps.map((p: any) => (
                <div key={p.key} className="pl" onClick={() => !final && setSheet({ type: 'player', key: p.key })}>
                  <div className="n">
                    {p.name}
                    {p.key === view.fin.captain && <span className="badge-c">C</span>}
                    {p.key === view.fin.vc && <span className="badge-vc">VC</span>}
                    <span className="tm">{short(p.team)}</span>
                    {tagOf(p) !== 'agent' && <span className={`tag ${tagOf(p)}`}>{tagOf(p)}</span>}
                  </div>
                  <div className="xp num">{p.xp}<small>{p.credit} cr</small></div>
                  <div className="r">{p.reason}</div>
                </div>
              ))}
            </div>
          );
        })}
        <div className="cap-reason">
          <b>{cap.name} (C){view.mk(view.fin.vc).name ? ` · ${view.mk(view.fin.vc).name} (VC)` : ''}</b>
          <div style={{ marginTop: 4 }}>{capChanged ? 'Captain changed by you.' : rec.captain_reason}</div>
        </div>
      </div>

      {view.benchAll.length > 0 && (
        <>
          <h2>Bench calls</h2>
          <div className="card flat">
            {view.benchAll.slice(0, 8).map((p: any) => (
              <div key={p.key} className="row sb" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)' }}>
                <div className="grow"><b>{p.name}</b> <span className="sub">{p.role} · {short(p.team)}</span><div className="sub">{view.benchReason.get(p.key) ?? p.reason}</div></div>
                <div className="num">{p.xp}<div className="sub">{p.credit} cr</div></div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="stack" style={{ marginTop: 14 }}>
        <div className="row"><button className="btn grow" onClick={copyText}>Copy for Dream11</button><button className="btn grow" onClick={saveImage}>Save image</button></div>
        {!final ? (
          <>
            <button className="btn primary block" disabled={!view.valid || busy} onClick={() => act('finalize', 'Team finalised')}>{view.valid ? 'Finalise my team' : 'Fix the rules to finalise'}</button>
            <p className="sub" style={{ margin: 0 }}>Tap any player to make them C/VC or swap them. You have the final say.</p>
            {d.decision.decisions.length > 0 && <button className="btn ghost block" onClick={() => act('reset', 'Back to the agent’s team')}>Reset to the agent’s team</button>}
          </>
        ) : (
          <>
            <Link href={`/match/${id}/result`} className="btn primary block">{d.hasActuals ? 'Edit match results' : 'Enter match results'}</Link>
            {!d.hasActuals && <button className="btn ghost block" onClick={() => act('reopen')}>Reopen for edits</button>}
          </>
        )}
      </div>

      {/* Player actions */}
      {sheet?.type === 'player' && sel && (
        <Sheet onClose={() => setSheet(null)}>
          <b style={{ fontSize: 17 }}>{sel.name}</b>
          <p className="sub">{sel.role} · {sel.team} · {sel.xp} xP · {sel.credit} cr</p>
          <div className="stack">
            <button className="btn block" disabled={sel.key === view.fin.captain} onClick={() => preview({ kind: 'captain', from: view.fin.captain, to: sel.key })}>Make captain (2x)</button>
            <button className="btn block" disabled={sel.key === view.fin.vc} onClick={() => preview({ kind: 'vice', from: view.fin.vc, to: sel.key })}>Make vice-captain (1.5x)</button>
            <button className="btn block" onClick={() => setSheet({ type: 'swap', key: sel.key })}>Swap this player out…</button>
          </div>
        </Sheet>
      )}
      {sheet?.type === 'swap' && sel && (
        <Sheet onClose={() => setSheet(null)}>
          <b style={{ fontSize: 17 }}>Replace {sel.name}</b>
          <p className="sub">Choose from the XI and impact subs.</p>
          {view.benchAll.map((p: any) => (
            <div key={p.key} className="row sb" style={{ padding: '10px 0', borderTop: '1px solid var(--line)', cursor: 'pointer' }} onClick={() => preview({ kind: 'swap', from: sel.key, to: p.key })}>
              <div className="grow"><b>{p.name}</b> <span className="sub">{p.role} · {short(p.team)} · {p.credit} cr</span></div>
              <div className="num">{p.xp}</div>
            </div>
          ))}
        </Sheet>
      )}

      {/* Decision gate: the agent states its case ONCE; Aryan then decides without further argument */}
      {pending && (
        <Sheet onClose={() => setPending(null)}>
          <b style={{ fontSize: 17 }}>Your call</b>
          {pending.preview.agentCase && <div className="banner" style={{ marginTop: 10 }}>{pending.preview.agentCase}</div>}
          {!pending.preview.valid && (
            <Banner kind="bad">
              <b>This breaks a Dream11 rule. Your pick is kept.</b>
              {pending.preview.violations.map((v: any) => <div key={v.message}>• {v.message}</div>)}
              {pending.preview.fixes.length > 0 && <div style={{ marginTop: 8 }}>To fit this player, drop one of these:</div>}
              {pending.preview.fixes.map((f: any) => (
                <div key={f.drop_key} className="row sb" style={{ marginTop: 6 }}>
                  <span>{f.drop} → {f.add} <span className="num">({f.xp_delta >= 0 ? '+' : ''}{f.xp_delta} xP)</span></span>
                  <button className="btn sm" disabled={busy} onClick={() => applyFix(f)}>Apply</button>
                </div>
              ))}
            </Banner>
          )}
          <div className="seg" style={{ margin: '12px 0' }}>
            <button className={tag === 'gut' ? 'on' : ''} onClick={() => setTag('gut')}>Gut</button>
            <button className={tag === 'reasoned' ? 'on' : ''} onClick={() => setTag('reasoned')}>Reasoned</button>
          </div>
          <div className="chips" style={{ marginBottom: 14 }}>{WHY.map((w) => <span key={w} className={`chip ${why === w ? 'on' : ''}`} onClick={() => { setWhy(why === w ? '' : w); if (why !== w) setTag('reasoned'); }}>{w}</span>)}</div>
          <div className="row"><button className="btn ghost grow" onClick={() => setPending(null)}>Cancel</button><button className="btn primary grow" disabled={busy} onClick={() => commit()}>Save my call</button></div>
        </Sheet>
      )}
      {toast}
    </>
  );
}
