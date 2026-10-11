'use client';
import { useEffect, useState } from 'react';

export function Spinner() {
  return <span className="spin" aria-hidden />;
}

export function Banner({ kind = 'warn', children }: { kind?: 'warn' | 'bad' | 'ok' | ''; children: React.ReactNode }) {
  return <div className={`banner ${kind}`}>{children}</div>;
}

export function Sheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2200);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg ? <div className="toast">{msg}</div> : null, setMsg] as const;
}

export const short = (team: string) =>
  team
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 3)
    .toUpperCase();
