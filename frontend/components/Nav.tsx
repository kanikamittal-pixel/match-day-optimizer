'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

const Icon = ({ d }: { d: string }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

export default function Nav() {
  const path = usePathname();
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => {
    if (path === '/login') return;
    try { const c = sessionStorage.getItem('md-fresh'); if (c) setFresh(c); } catch { /* storage unavailable */ }
    fetch('/api/status').then((r) => (r.ok ? r.json() : null)).then((j) => {
      const t = j?.history?.latest ? `History through ${new Date(j.history.latest).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}` : null;
      if (t) { setFresh(t); try { sessionStorage.setItem('md-fresh', t); } catch { /* ignore */ } }
    }).catch(() => {});
  }, [path]);
  if (path === '/login') return null;
  const items: [string, string, string][] = [
    ['/', 'Matches', 'M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z'],
    ['/insights', 'Insights', 'M4 20V10M10 20V4M16 20v-7M22 20H2'],
    ['/proof', 'Proof', 'M9 12l2 2 4-4M12 3l7 3v5c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6z'],
    ['/settings', 'Settings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h0a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h0a1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v0a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  ];
  const on = (href: string) => (href === '/' ? path === '/' || path.startsWith('/match') : path.startsWith(href));
  return (
    <>
      <div className="topbar">
        <div className="in">
          <Link href="/" className="brand">Match<b>Day</b></Link>
          <span className="fresh" style={{ marginLeft: 'auto' }}>{fresh ? <><i /> {fresh}</> : 'Fantasy cricket'}</span>
        </div>
      </div>
      <nav className="tabbar">
        {items.map(([href, label, d]) => (
          <Link key={href} href={href} className={on(href) ? 'on' : ''}>
            <Icon d={d} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </>
  );
}
