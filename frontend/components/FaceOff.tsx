'use client';
import { useMemo, useState } from 'react';
import Sparkline from './Sparkline';
import { short } from './ui';

export interface WatchPlayer { player: string; n: number; recent: number[]; mean: number }
type Pool = { team: string; p: WatchPlayer }[];

const KEY = 'faceoff:score';
const load = (): { agree: number; total: number } => {
  try { return JSON.parse(localStorage.getItem(KEY) || '') || { agree: 0, total: 0 }; } catch { return { agree: 0, total: 0 }; }
};
const save = (s: { agree: number; total: number }) => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* private window: the game still works */ } };

/** Heat of a player: their last 3 scores against their 10-match average. */
export function heat(p: WatchPlayer): 'hot' | 'cold' | null {
  if (p.recent.length < 6) return null;
  const last3 = p.recent.slice(0, 3).reduce((s, x) => s + x, 0) / 3;
  return last3 - p.mean >= 10 ? 'hot' : last3 - p.mean <= -10 ? 'cold' : null;
}

/** A small game on the dashboard: two players from tomorrow's match, tap the one you would captain, see what the numbers say. */
export default function FaceOff({ teams }: { teams: { team: string; players: WatchPlayer[] }[] }) {
  const pool: Pool = useMemo(() => teams.flatMap((t) => t.players.map((p) => ({ team: t.team, p }))), [teams]);
  const pairs = useMemo(() => {
    const out: [Pool[number], Pool[number]][] = [];
    for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) if (Math.abs(pool[i].p.mean - pool[j].p.mean) >= 2) out.push([pool[i], pool[j]]);
    return out.sort(() => Math.random() - 0.5);
  }, [pool]);
  const [idx, setIdx] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const [score, setScore] = useState(load);
  if (pairs.length === 0) return null;
  const [a, b] = pairs[idx % pairs.length];
  const winner = a.p.mean >= b.p.mean ? 0 : 1;
  const duo = [a, b];

  function choose(i: number) {
    if (pick !== null) return;
    setPick(i);
    const s = { agree: score.agree + (i === winner ? 1 : 0), total: score.total + 1 };
    setScore(s); save(s);
  }

  return (
    <section className="panel faceoff">
      <div className="ph"><b>Captain face-off</b><span className="sub">{score.total ? `You matched the numbers ${score.agree} of ${score.total}` : 'Who would you captain?'}</span></div>
      <div className="fo-grid">
        {duo.map((x, i) => (
          <button key={x.p.player} className={`fo-card ${pick === null ? '' : i === winner ? 'win' : 'lose'} ${pick === i ? 'chosen' : ''}`} onClick={() => choose(i)} disabled={pick !== null}>
            <span className="d-code sm">{short(x.team)}</span>
            <div className="fo-name">{x.p.player}</div>
            <Sparkline values={x.p.recent} />
            <div className="fo-mean num">{pick === null ? '?' : x.p.mean}</div>
            <div className="sub">{pick === null ? 'average ???' : 'avg of last 10 T20s'}</div>
          </button>
        ))}
      </div>
      {pick !== null && (
        <div className="fo-result">
          <b>{pick === winner ? '🎯 Spot on.' : '🤔 Different call.'}</b> The numbers lean to {duo[winner].p.player} ({duo[winner].p.mean} against {duo[1 - winner].p.mean}). Form is only one input; pitch and role count too.
          <div><button className="btn sm" onClick={() => { setPick(null); setIdx(idx + 1); }}>Next pair →</button></div>
        </div>
      )}
    </section>
  );
}
