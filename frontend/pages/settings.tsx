'use client';
import { useEffect, useState } from 'react';
import { api } from '@/frontend/api';
import { Banner, Spinner, useToast } from '@/frontend/components/ui';
import { ROLES } from '@/shared/types';

export default function Settings() {
  const [rules, setRules] = useState<any>(null);
  const [weights, setWeights] = useState<any[]>([]);
  const [playbook, setPlaybook] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [toast, setToast] = useToast();
  const [nr, setNr] = useState({ situation: '', rule: '', owner: 'agent' });
  const [openV, setOpenV] = useState<number | null>(null);

  const load = async () => {
    try {
      const [r, w, p] = await Promise.all([api('/api/settings/rules'), api('/api/settings/weights'), api('/api/settings/playbook')]);
      setRules(r.rules); setWeights(w.versions); setPlaybook(p.rules);
    } catch (e: any) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);
  if (err) return <Banner kind="bad">{err}</Banner>;
  if (!rules) return <p className="sub" style={{ marginTop: 30 }}><Spinner /> Loading…</p>;

  const setNum = (k: string, v: string) => setRules({ ...rules, [k]: v });
  const setRole = (which: 'role_min' | 'role_max', r: string, v: string) => setRules({ ...rules, [which]: { ...rules[which], [r]: v } });
  const call = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); setToast(ok); await load(); } catch (e: any) { setToast(e.message); } };

  const active = weights.find((w) => w.active);
  return (
    <>
      <h1>Settings</h1>
      <h2>Dream11 rules</h2>
      <div className="card stack">
        <div className="row"><div className="grow"><label className="f">Credit cap</label><input type="number" value={rules.credit_cap} onChange={(e) => setNum('credit_cap', e.target.value)} /></div><div className="grow"><label className="f">Team size</label><input type="number" value={rules.team_size} onChange={(e) => setNum('team_size', e.target.value)} /></div><div className="grow"><label className="f">Max / team</label><input type="number" value={rules.max_per_team} onChange={(e) => setNum('max_per_team', e.target.value)} /></div></div>
        <div className="row"><div className="grow"><label className="f">Captain ×</label><input type="number" step="0.5" value={rules.captain_mult} onChange={(e) => setNum('captain_mult', e.target.value)} /></div><div className="grow"><label className="f">Vice-captain ×</label><input type="number" step="0.5" value={rules.vc_mult} onChange={(e) => setNum('vc_mult', e.target.value)} /></div></div>
        <table className="t"><thead><tr><th>Role</th><th>Min</th><th>Max</th></tr></thead><tbody>{ROLES.map((r) => (<tr key={r}><td><b>{r}</b></td><td><input type="number" value={rules.role_min[r]} onChange={(e) => setRole('role_min', r, e.target.value)} /></td><td><input type="number" value={rules.role_max[r]} onChange={(e) => setRole('role_max', r, e.target.value)} /></td></tr>))}</tbody></table>
        <button className="btn primary block" onClick={() => call(() => api('/api/settings/rules', { method: 'PUT', json: rules }), 'Rules saved')}>Save rules</button>
      </div>

      <h2>Playbook & mix rules</h2>
      <p className="sub">Rules the agent must follow. “Owner” says whose judgement wins in that situation, e.g. Aryan decides spinners at turning pitches; the agent decides captaincy.</p>
      {playbook.map((p) => (
        <div key={p.id} className="card row" style={{ opacity: p.active ? 1 : 0.5 }}>
          <div className="grow"><b>{p.situation}</b><div>{p.rule}</div><div className="sub">v{p.version}{p.active ? '' : ' · retired'}</div></div>
          <span className={`pill ${p.owner === 'aryan' ? 'warn' : 'ok'}`}>{p.owner}</span>
          <button className="btn sm" onClick={() => call(() => api('/api/settings/playbook', { method: 'PATCH', json: { id: p.id, active: !p.active } }), p.active ? 'Retired' : 'Restored')}>{p.active ? 'Retire' : 'Restore'}</button>
        </div>
      ))}
      <div className="card stack">
        <input type="text" placeholder="Situation (e.g. spinners at turning pitches)" value={nr.situation} onChange={(e) => setNr({ ...nr, situation: e.target.value })} />
        <input type="text" placeholder="Rule (e.g. always include two spinners)" value={nr.rule} onChange={(e) => setNr({ ...nr, rule: e.target.value })} />
        <div className="seg"><button className={nr.owner === 'agent' ? 'on' : ''} onClick={() => setNr({ ...nr, owner: 'agent' })}>Agent decides</button><button className={nr.owner === 'aryan' ? 'on' : ''} onClick={() => setNr({ ...nr, owner: 'aryan' })}>Aryan decides</button></div>
        <button className="btn block" onClick={() => call(async () => { await api('/api/settings/playbook', { method: 'POST', json: nr }); setNr({ situation: '', rule: '', owner: 'agent' }); }, 'Rule added')}>Add rule</button>
      </div>

      <h2>Scoring weights · v{active?.version}</h2>
      <p className="sub">Only the active version is used for predictions. Changes appear only after you approve them in Insights. Any version can be restored.</p>
      {weights.map((w) => (
        <div key={w.version} className="card">
          <div className="row sb"><div><b>Version {w.version}</b> {w.active && <span className="pill ok">Active</span>}<div className="sub">{w.note}</div></div>
            <div className="row"><button className="btn sm ghost" onClick={() => setOpenV(openV === w.version ? null : w.version)}>{openV === w.version ? 'Hide' : 'View'}</button>{!w.active && <button className="btn sm" onClick={() => call(() => api('/api/settings/weights', { method: 'POST', json: { activate: w.version } }), `Rolled back to v${w.version}`)}>Restore</button>}</div></div>
          {openV === w.version && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, color: 'var(--mute)' }}>{Object.entries(w.weights).map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>}
        </div>
      ))}

      <button className="btn ghost block" style={{ marginTop: 24 }} onClick={async () => { await api('/api/auth/logout', { method: 'POST' }); window.location.href = '/login'; }}>Sign out</button>
      {toast}
    </>
  );
}
