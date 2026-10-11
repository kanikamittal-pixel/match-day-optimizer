'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/client';
import { Banner, Spinner } from '@/components/ui';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [demo, setDemo] = useState(false);
  useEffect(() => { api('/api/auth/demo').then((r) => setDemo(r.enabled)).catch(() => {}); }, []);

  async function demoLogin() {
    setBusy(true);
    setErr('');
    try {
      await api('/api/auth/demo', { method: 'POST' });
      window.location.href = '/';
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await api('/api/auth/login', { method: 'POST', json: { email, password } });
      window.location.href = '/';
    } catch (e: any) {
      setErr(e.message);
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 380, margin: '0 auto', padding: '14vh 16px 0' }}>
      <div className="brand" style={{ fontSize: 28 }}>
        Match<b>Day</b>
      </div>
      <p className="sub" style={{ margin: '6px 0 22px' }}>Research done before the toss.</p>
      <form onSubmit={submit} className="stack">
        <div><label className="f">Email</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></div>
        <div><label className="f">Password</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
        {err && <Banner kind="bad">{err}</Banner>}
        <button className="btn primary block" disabled={busy}>{busy ? <Spinner /> : 'Sign in'}</button>
      </form>
      {demo && (
        <button className="btn block" style={{ marginTop: 10 }} disabled={busy} onClick={demoLogin}>Continue as demo (reviewers)</button>
      )}
    </div>
  );
}
