'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Nav() {
  const path = usePathname();
  if (path === '/login') return null;
  const items = [
    ['/', 'Matches'],
    ['/insights', 'Insights'],
    ['/settings', 'Settings'],
  ];
  return (
    <div className="topbar">
      <div className="in">
        <Link href="/" className="brand">
          Match<b>Day</b>
        </Link>
        <nav className="nav">
          {items.map(([href, label]) => (
            <Link key={href} href={href} className={(href === '/' ? path === '/' || path.startsWith('/match') : path.startsWith(href)) ? 'on' : ''}>
              {label}
            </Link>
          ))}
        </nav>
      </div>
    </div>
  );
}
