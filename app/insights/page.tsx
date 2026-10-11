'use client';
import { useEffect, useState } from 'react';
import { api } from '@/client/api';
import { Banner, Spinner, useToast } from '@/client/components/ui';

export default function Insights() {
  const [d, setD] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [ruleText, setRuleText] = useState<Record<string, string>>({});
  const [toast, setToast] = useToast();
  const load = () => api('/api/insights').then(setD).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  if (err) return <Banner kind="bad">{err}</Banner>;
  if (!d) return <p className="sub" style={{ marginTop: 30 }}><Spinner /> Crunching…</p>;

  const last = d.overTime[d.overTime.length - 1];
  const maxErr = Math.max(1, ...d.overTime.map((o: any) => o.mae));
  const cv = d.cvcHitRate;
  const pct = (x: { hits: number; total: number }) => (x.total ? `${Math.round((x.hits / x.total) * 100)}%` : '–');

  async function analyze() {
    setBusy(true);
    try { const r = await api('/api/insights/analyze', { method: 'POST' }); setToast(r.message); await load(); } catch (e: any) { setToast(e.message); }
    setBusy(false);
  }
  async function decide(id: string, decision: 'approve' | 'reject') {
    try { await api('/api/settings/suggestions', { method: 'POST', json: { id, decision } }); setToast(decision === 'approve' ? 'Approved: new weights version active' : 'Rejected'); await load(); } catch (e: any) { setToast(e.message); }
  }
  async function makeRule(situation: string) {
    const rule = ruleText[situation]?.trim();
    if (!rule) return setToast('Write the rule first');
    try { await api('/api/settings/playbook', { method: 'POST', json: { situation, rule, owner: 'aryan' } }); setToast('Playbook rule added'); await load(); } catch (e: any) { setToast(e.message); }
  }

  return (
    <>
      <h1>Insights</h1>
      <p className="sub">{d.matchesScored} match{d.matchesScored === 1 ? '' : 'es'} scored · {d.playersScored} player predictions checked</p>

      {d.matchesScored === 0 && <Banner>Nothing to learn from yet. Enter results after your first match and this fills in.</Banner>}

      <div className="tc-meta" style={{ marginTop: 14 }}>
        <div className="stat"><div className="k">Last match error</div><div className="v num">{last ? `${last.mae.toFixed(1)}` : '–'}</div><div className="sub">pts / player</div></div>
        <div className="stat"><div className="k">Agent C/VC</div><div className="v num">{pct(cv.agent)}</div><div className="sub">top-3 hit</div></div>
        <div className="stat"><div className="k">Your C</div><div className="v num">{pct(cv.aryan)}</div><div className="sub">top-3 hit</div></div>
      </div>

      <h2>What the data says</h2>
      {d.findings.length ? d.findings.map((f: string) => <div key={f} className="finding">{f}</div>) : <div className="card"><b>Too early to tell.</b><div className="sub">A conclusion needs at least {d.minN} players in the same situation.</div></div>}
      {d.tooEarly.length > 0 && (
        <div className="sub" style={{ marginBottom: 8 }}>Building up: {d.tooEarly.slice(0, 4).map((s: any) => `${s.label} (${s.n}/${d.minN})`).join(' · ')}</div>
      )}
      <button className="btn block" onClick={analyze} disabled={busy}>{busy ? <Spinner /> : 'Look for patterns'}</button>

      {d.overTime.length > 0 && (
        <>
          <h2>Prediction error over time</h2>
          <div className="card">
            <div className="bars" style={{ marginTop: 18 }}>{d.overTime.slice(-14).map((o: any) => <div key={o.match_id} className="b" style={{ height: `${(o.mae / maxErr) * 100}%` }}><span className="num">{o.mae.toFixed(0)}</span></div>)}</div>
            <div className="sub" style={{ marginTop: 6 }}>Average points the agent missed by, per player, match by match. Lower is better.</div>
          </div>
        </>
      )}

      <h2>Agent vs Aryan</h2>
      {d.scoreboard.length ? (
        <div className="card flat">
          <table className="t"><thead><tr><th>Situation</th><th className="r">n</th><th className="r">Agent</th><th className="r">You</th></tr></thead>
            <tbody>{d.scoreboard.map((s: any) => (
              <tr key={s.situation}><td>{s.situation}</td><td className="r num">{s.n}</td><td className="r num" style={{ color: s.agent > s.aryan ? 'var(--accent)' : undefined }}>{s.agent}</td><td className="r num" style={{ color: s.aryan > s.agent ? 'var(--accent)' : undefined }}>{s.aryan}</td></tr>
            ))}</tbody></table>
        </div>
      ) : <p className="sub">Appears once you override a pick and enter results.</p>}
      {(d.tagStats.gut.n > 0 || d.tagStats.reasoned.n > 0) && (
        <p className="sub">Your overrides beat the agent: gut {d.tagStats.gut.aryanWins}/{d.tagStats.gut.n} · reasoned {d.tagStats.reasoned.aryanWins}/{d.tagStats.reasoned.n}.</p>
      )}

      {d.nudges.length > 0 && (
        <>
          <h2>Make it a rule?</h2>
          {d.nudges.map((n: any) => (
            <div key={n.situation} className="card stack">
              <div>You’ve overridden <b>{n.situation}</b> {n.count} times. Want a playbook rule?</div>
              <input type="text" placeholder="e.g. Prefer spinners here; fade openers" value={ruleText[n.situation] ?? ''} onChange={(e) => setRuleText({ ...ruleText, [n.situation]: e.target.value })} />
              <button className="btn" onClick={() => makeRule(n.situation)}>Add to my playbook</button>
            </div>
          ))}
        </>
      )}

      <h2>Suggested weight changes</h2>
      {d.suggestions.length ? d.suggestions.map((s: any) => (
        <div key={s.id} className="card stack">
          <div className="row sb"><b>{s.weight_key}</b><span className="num">{s.current_value} → {s.suggested_value}</span></div>
          <div className="sub">{s.situation}</div>
          <div>{s.evidence.summary}</div>
          <div className="row"><button className="btn ghost grow" onClick={() => decide(s.id, 'reject')}>Reject</button><button className="btn primary grow" onClick={() => decide(s.id, 'approve')}>Approve</button></div>
        </div>
      )) : <p className="sub">Nothing waiting. Nothing changes without your approval.</p>}
      {toast}
    </>
  );
}
