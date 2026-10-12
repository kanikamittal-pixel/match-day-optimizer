'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/frontend/api';
import { Banner, Sheet, Spinner, short, useToast } from '@/frontend/components/ui';
import { ROLES } from '@/shared/types';
import { creditsUsed, validateTeam } from '@/shared/rules';
import { historyLine, partsLine } from '@/shared/form';

type Pending = { change: { kind: 'swap' | 'captain' | 'vice'; from: string; to: string }; preview: any } | null;
const WHY = ['Venue record', 'Pitch', 'Matchup', 'Team news', 'Balance'];

export default function TeamPage() {
  const { id } = useParams<{ id: string }>();
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [sheet, setSheet] = useState<{ type: 'player' | 'swap' | 'bench'; key: string } | null>(null);
  const [locks, setLocks] = useState<Set<string>>(new Set());
  const [excludes, setExcludes] = useState<Set<string>>(new Set());
  const [reopt, setReopt] = useState<any>(null);
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
    const stats: Record<string, any> = d.stats ?? {};
    const parts: Record<string, any> = d.parts ?? {};
    const mk = (k: string) => ({ key: k, hist: historyLine(stats[k]), parts: partsLine(parts[k]?.base, parts[k]?.adjustment), name: cred.get(k)?.name ?? preds.get(k)?.player_name ?? k, team: cred.get(k)?.team ?? '', role: cred.get(k)?.role ?? preds.get(k)?.role, credit: Number(cred.get(k)?.credit ?? NaN), xp: Number(preds.get(k)?.expected_points ?? 0), reason: preds.get(k)?.reason ?? '' });
    const xi = fin.xi.map(mk);
    const eligible = new Set<string>([...(d.match.xi?.teamA ?? []), ...(d.match.xi?.teamB ?? []), ...(d.match.xi?.impact ?? [])]);
    const benchAll = [...eligible].filter((k) => !fin.xi.includes(k) && preds.has(k)).map(mk).sort((a, b) => b.xp - a.xp);
    const violations = validateTeam(xi, d.rules, eligible);
    const types = new Map<string, string>();
    for (const e of d.decision.decisions) { if (e.kind === 'swap') types.set(e.to, e.tag); else types.set(`${e.kind}:${e.to}`, e.tag); }
    const benchReason = new Map<string, string>(rec.bench.map((b: any) => [b.key, b.reason]));
    const everyone = [...new Set([...fin.xi, ...benchAll.map((b: any) => b.key)])].map(mk);
    const noHistory = everyone
      .filter((p: any) => stats[p.key]?.base === undefined)
      .map((p: any) => {
        const h = stats[p.key];
        const why = !h ? 'history not looked up yet' : h.found && h.n_all ? `only ${h.n_all} T20 match${h.n_all === 1 ? '' : 'es'} on record (${h.cs_name})` : h.found ? h.note ?? 'too little history' : h.note ?? 'no history found';
        return { name: p.name, team: p.team, in_xi: fin.xi.includes(p.key), why };
      });
    return { noHistory, xi, benchAll, violations, types, fin, rec, benchReason, credits: creditsUsed(xi), totalXp: Math.round(xi.reduce((s: number, p: any) => s + p.xp, 0) * 10) / 10, mk, valid: violations.length === 0 };
  }, [d]);

  if (err && !d) return <Banner kind="bad">{err}</Banner>;
  if (!d) return <p className="sub" style={{ marginTop: 30 }}><Spinner /> Loading…</p>;
  if (!view) return <><Banner>No team built yet.</Banner><Link href={`/match/${id}`} className="btn">Back to setup</Link></>;

  const { match: m, rules } = d;
  const final = d.decision.status === 'final';
  const pre = d.decision.stage === 'pre_toss';
  const unchecked = view.xi.some((p: any) => !(p.credit > 0)); // credits skipped: cap not applied
  const left = Math.round((rules.credit_cap - view.credits) * 10) / 10;
  const cr = (c: number) => (c > 0 ? `${c} cr` : 'no credit');

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
  const flip = (set: Set<string>, k: string) => { const n = new Set(set); n.has(k) ? n.delete(k) : n.add(k); return n; };
  const toggleLock = (k: string) => { setLocks(flip(locks, k)); if (excludes.has(k)) setExcludes(flip(excludes, k)); setSheet(null); };
  const toggleExclude = (k: string) => { setExcludes(flip(excludes, k)); if (locks.has(k)) setLocks(flip(locks, k)); setSheet(null); };
  async function previewReopt() {
    setBusy(true);
    try {
      const r = await api(`/api/matches/${id}/decision`, { method: 'POST', json: { action: 'reopt_preview', locks: [...locks], excludes: [...excludes] } });
      setReopt(r); setTag('gut'); setWhy('');
    } catch (e: any) { setToast(e.message); }
    setBusy(false);
  }
  async function commitReopt() {
    setBusy(true);
    try {
      await api(`/api/matches/${id}/decision`, { method: 'POST', json: { action: 'reopt_commit', locks: [...locks], excludes: [...excludes], tag, reason: why } });
      setReopt(null); setLocks(new Set()); setExcludes(new Set()); await load();
    } catch (e: any) { setToast(e.message); }
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
      ) : unchecked ? (
        <Banner kind="warn"><b>Built without credits.</b> Role and team limits are met, but the {rules.credit_cap}-credit cap was <b>not checked</b>. Dream11 may reject it. Add credits on the setup page and rebuild to apply the cap. <Link href={`/match/${id}`} style={{ textDecoration: 'underline' }}>Go to setup</Link></Banner>
      ) : (
        <Banner kind="ok"><b>Dream11-valid as shown.</b> {view.credits}/{rules.credit_cap} credits, role and team limits met.</Banner>
      )}
      {rec.cvc_source === 'fallback' && <Banner kind="warn">Captain picks fell back to the two highest expected scorers (AI pick could not be validated).</Banner>}

      <div className="d-pitch" ref={card}>
        <div className="d-head">
          <div>
            <div className="d-title">{m.team_a} vs {m.team_b}</div>
            <div className="d-sub">{m.format} · {m.venue ?? 'Venue TBC'} · {pre ? 'PRE-TOSS XI' : 'FINAL XI'}</div>
          </div>
        </div>
        <div className="d-bar">
          <div><small>Players</small><b className="num">{view.xi.length}/11</b></div>
          <div className="d-mid"><span className="d-code">{short(m.team_a)}</span><b className="num">{view.xi.filter((p: any) => p.team === m.team_a).length} : {view.xi.filter((p: any) => p.team === m.team_b).length}</b><span className="d-code b">{short(m.team_b)}</span></div>
          <div style={{ textAlign: 'right' }}><small>Credits left</small><b className="num" style={{ color: left < 0 && !unchecked ? 'var(--red)' : undefined }}>{unchecked ? '—' : left}</b></div>
        </div>
        <div className="d-field">
          {([['WK', 'WICKET-KEEPERS'], ['BAT', 'BATTERS'], ['AR', 'ALL-ROUNDERS'], ['BOWL', 'BOWLERS']] as const).map(([r, label]) => {
            const ps = view.xi.filter((p: any) => p.role === r);
            if (!ps.length) return null;
            return (
              <div key={r} className="d-group">
                <div className="d-role">{label}</div>
                <div className="d-row">
                  {ps.map((p: any) => {
                    const init = p.name.replace(/\(.*?\)/g, '').trim().split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2).toUpperCase();
                    const last = p.name.replace(/\(.*?\)/g, '').trim();
                    return (
                      <div key={p.key} className="d-pl" onClick={() => !final && setSheet({ type: 'player', key: p.key })}>
                        <div className={`d-av ${p.team === m.team_a ? 'ta' : 'tb'}`}>
                          {init}
                          {p.key === view.fin.captain && <span className="d-badge c">C</span>}
                          {p.key === view.fin.vc && <span className="d-badge vc">VC</span>}
                          {locks.has(p.key) && <span className="d-lock" title="Locked in">🔒</span>}
                        </div>
                        <div className="d-name">{last}</div>
                        <div className="d-cr">{p.credit > 0 ? `${p.credit} Cr` : `${p.xp} xP`}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="d-foot"><span>Expected <b className="num">{view.totalXp}</b> pts</span><span>C {cap.name} · VC {view.mk(view.fin.vc).name}</span></div>
      </div>

      {view.noHistory.length > 0 && (
        <div className="banner warn">
          <b>No fantasy history for {view.noHistory.length} player{view.noHistory.length === 1 ? '' : 's'}.</b> Their expected points come from Gemini's own estimate, not from a computed base.
          {view.noHistory.map((p: any) => (
            <div key={p.name + p.team} style={{ marginTop: 4 }}>
              • <b>{p.name}</b> <span className="sub">({short(p.team)}{p.in_xi ? '' : ', bench'})</span>: {p.why}
            </div>
          ))}
        </div>
      )}

      <h2>Why these picks</h2>
      <div className="card flat">
        {ROLES.flatMap((r) => view.xi.filter((p: any) => p.role === r)).map((p: any) => (
          <div key={p.key} className="why" onClick={() => !final && setSheet({ type: 'player', key: p.key })}>
            <div className="row sb">
              <div className="n">
                {p.name}
                {p.key === view.fin.captain && <span className="badge-c">C</span>}
                {p.key === view.fin.vc && <span className="badge-vc">VC</span>}
                <span className="tm">{p.role} · {short(p.team)}</span>
                {tagOf(p) !== 'agent' && <span className={`tag ${tagOf(p)}`}>{tagOf(p)}</span>}
              </div>
              <div className="xp num">{p.xp}</div>
            </div>
            <div className="r">{p.reason}</div>
            <div className="r dim">{p.parts ? `${p.parts} · ` : ''}{p.hist}</div>
          </div>
        ))}
      </div>
      <div className="card" style={{ marginTop: 10 }}>
        <b>{cap.name} (C) · {view.mk(view.fin.vc).name} (VC)</b>
        <div style={{ marginTop: 4 }}>{capChanged ? 'Captain changed by you.' : rec.captain_reason}</div>
      </div>

      {view.benchAll.length > 0 && (
        <>
          <h2>Bench calls</h2>
          <div className="card flat">
            {view.benchAll.slice(0, 8).map((p: any) => (
              <div key={p.key} className="row sb" style={{ padding: '10px 14px', borderTop: '1px solid var(--line)', cursor: final ? 'default' : 'pointer', opacity: excludes.has(p.key) ? 0.5 : 1 }} onClick={() => !final && setSheet({ type: 'bench', key: p.key })}>
                <div className="grow"><b style={{ textDecoration: excludes.has(p.key) ? 'line-through' : 'none' }}>{p.name}</b> <span className="sub">{p.role} · {short(p.team)}</span>{locks.has(p.key) && <span className="pill ok" style={{ marginLeft: 6 }}>Locked</span>}{excludes.has(p.key) && <span className="pill bad" style={{ marginLeft: 6 }}>Excluded</span>}<div className="sub">{view.benchReason.get(p.key) ?? p.reason}</div></div>
                <div className="num">{p.xp}<div className="sub">{cr(p.credit)}</div></div>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="stack" style={{ marginTop: 14 }}>
        <div className="row"><button className="btn grow" onClick={copyText}>Copy for Dream11</button><button className="btn grow" onClick={saveImage}>Save image</button></div>
        {!final ? (
          <>
            <button className="btn primary block" disabled={!view.valid || busy} onClick={() => act('finalize', 'Team finalised')}>{!view.valid ? 'Fix the rules to finalise' : unchecked ? 'Finalise (credits unchecked)' : 'Finalise my team'}</button>
            <p className="sub" style={{ margin: 0 }}>Tap any player to make them C/VC or swap them. You have the final say.</p>
            {d.decision.decisions.length > 0 && <button className="btn ghost block" onClick={() => act('reset', 'Back to the agent’s team')}>Reset to the agent’s team</button>}
          </>
        ) : (
          <>
            {m.starts_at && new Date(m.starts_at).getTime() > Date.now()
              ? <p className="sub" style={{ margin: 0 }}>Results open once the match has started.</p>
              : <Link href={`/match/${id}/result${d.hasActuals ? '' : '?fetch=1'}`} className="btn primary block">{d.hasActuals ? 'Edit match results' : 'Fetch match results'}</Link>}
            {!d.hasActuals && <button className="btn ghost block" onClick={() => act('reopen')}>Reopen for edits</button>}
          </>
        )}
      </div>

      {/* Player actions */}
      {sheet?.type === 'player' && sel && (
        <Sheet onClose={() => setSheet(null)}>
          <div className="row sb"><b style={{ fontSize: 18 }}>{sel.name}</b><span className="num" style={{ fontSize: 26 }}>{sel.xp}</span></div>
          <p className="sub" style={{ margin: '2px 0 8px' }}>{sel.role} · {sel.team} · expected points · {cr(sel.credit)}</p>
          <div className="pinfo">
            {sel.parts && <div><span className="k">How it was built</span>{sel.parts}</div>}
            <div><span className="k">History</span>{sel.hist}</div>
            {sel.reason && <div><span className="k">Why</span>{sel.reason}</div>}
          </div>
          <div className="stack">
            <button className="btn block" disabled={sel.key === view.fin.captain} onClick={() => preview({ kind: 'captain', from: view.fin.captain, to: sel.key })}>Make captain (2x)</button>
            <button className="btn block" disabled={sel.key === view.fin.vc} onClick={() => preview({ kind: 'vice', from: view.fin.vc, to: sel.key })}>Make vice-captain (1.5x)</button>
            <button className="btn block" onClick={() => setSheet({ type: 'swap', key: sel.key })}>Swap this player out…</button>
            <button className="btn block" onClick={() => toggleLock(sel.key)}>{locks.has(sel.key) ? '🔓 Unlock' : '🔒 Lock in XI'}</button>
            <button className="btn block danger" onClick={() => toggleExclude(sel.key)}>{excludes.has(sel.key) ? 'Include again' : 'Exclude from the XI'}</button>
          </div>
        </Sheet>
      )}
      {sheet?.type === 'bench' && sel && (
        <Sheet onClose={() => setSheet(null)}>
          <b style={{ fontSize: 17 }}>{sel.name}</b>
          <p className="sub">{sel.role} · {sel.team} · {sel.xp} xP · {cr(sel.credit)} · on the bench</p>
          <div className="stack">
            <button className="btn block" onClick={() => toggleLock(sel.key)}>{locks.has(sel.key) ? '🔓 Unlock' : '🔒 Lock into the XI'}</button>
            <button className="btn block danger" onClick={() => toggleExclude(sel.key)}>{excludes.has(sel.key) ? 'Include again' : 'Exclude from consideration'}</button>
          </div>
        </Sheet>
      )}
      {sheet?.type === 'swap' && sel && (
        <Sheet onClose={() => setSheet(null)}>
          <b style={{ fontSize: 17 }}>Replace {sel.name}</b>
          <p className="sub">Choose from the XI and impact subs.</p>
          {view.benchAll.map((p: any) => (
            <div key={p.key} className="row sb" style={{ padding: '10px 0', borderTop: '1px solid var(--line)', cursor: 'pointer' }} onClick={() => preview({ kind: 'swap', from: sel.key, to: p.key })}>
              <div className="grow"><b>{p.name}</b> <span className="sub">{p.role} · {short(p.team)} · {cr(p.credit)}</span></div>
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
      {(locks.size > 0 || excludes.size > 0) && !final && !reopt && (
        <div className="reopt-bar">
          <button className="btn primary grow" disabled={busy} onClick={previewReopt}>Re-optimise · {locks.size} locked · {excludes.size} excluded</button>
          <button className="btn ghost" onClick={() => { setLocks(new Set()); setExcludes(new Set()); }}>Clear</button>
        </div>
      )}
      {reopt && (
        <Sheet onClose={() => setReopt(null)}>
          <b style={{ fontSize: 17 }}>Re-optimise around your picks</b>
          <div className="banner" style={{ marginTop: 10 }}>{reopt.agentCase}</div>
          {reopt.changes.map((c: any) => (
            <div key={c.from} className="row sb" style={{ padding: '8px 0', borderTop: '1px solid var(--line)' }}>
              <span>{c.fromName} <span className="sub">({c.fromXp} xP)</span> → <b>{c.toName}</b> <span className="sub">({c.toXp} xP)</span></span>
            </div>
          ))}
          {reopt.captain && <p className="sub">Captain moves from {reopt.captain.from} to {reopt.captain.to} (the old captain left the XI).</p>}
          {reopt.vc && <p className="sub">Vice-captain moves from {reopt.vc.from} to {reopt.vc.to}.</p>}
          <div className="seg" style={{ margin: '12px 0' }}>
            <button className={tag === 'gut' ? 'on' : ''} onClick={() => setTag('gut')}>Gut</button>
            <button className={tag === 'reasoned' ? 'on' : ''} onClick={() => setTag('reasoned')}>Reasoned</button>
          </div>
          <div className="chips" style={{ marginBottom: 14 }}>{WHY.map((w) => <span key={w} className={`chip ${why === w ? 'on' : ''}`} onClick={() => { setWhy(why === w ? '' : w); if (why !== w) setTag('reasoned'); }}>{w}</span>)}</div>
          <div className="row"><button className="btn ghost grow" onClick={() => setReopt(null)}>Cancel</button><button className="btn primary grow" disabled={busy || !reopt.changes.length} onClick={commitReopt}>{reopt.changes.length ? 'Save this team' : 'Nothing to change'}</button></div>
        </Sheet>
      )}
      {toast}
    </>
  );
}
