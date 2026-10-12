'use client';
import { useEffect, useState } from 'react';
import { api } from '@/frontend/api';
import { Banner, useToast } from './ui';

/** Aryan's choices next to the agent's: where they differ, what pattern that shows, and a one-tap way to teach it (never automatic). */
export default function StyleCard() {
  const [d, setD] = useState<any>(null);
  const [toast, setToast] = useToast();
  const load = () => api('/api/insights/style').then(setD).catch(() => {});
  useEffect(() => { load(); }, []);
  if (!d) return <div className="skel" style={{ height: 120, marginTop: 14 }} />;
  const s = d.summary;

  async function adopt() {
    try { await api('/api/settings/playbook', { method: 'POST', json: { situation: d.suggestion.situation, rule: d.suggestion.rule, owner: 'aryan' } }); setToast('Added to your playbook'); load(); } catch (e: any) { setToast(e.message); }
  }

  return (
    <>
      <h2>Your choices vs the agent's</h2>
      {!s || d.withOverrides === 0 ? (
        <div className="card">
          <b>No overrides yet.</b>
          <p className="sub" style={{ margin: '4px 0 0' }}>{d.teams} team{d.teams === 1 ? '' : 's'} built so far and you have kept every recommendation. Swap a player or change the captain on a team card and this fills in: which players you replaced, the expected points you gave up, which roles you lean towards, and how your captain picks rank against the agent's list.</p>
        </div>
      ) : (
        <>
          <div className="tiles">
            <div className="tile"><div className="k">Your swaps</div><div className="v num">{s.swaps}</div><div className="s">{s.gut} gut · {s.reasoned} reasoned</div></div>
            <div className="tile"><div className="k">Points you gave up</div><div className="v num">{s.avgGivenUp}</div><div className="s">expected points per swap, on average</div></div>
            <div className="tile"><div className="k">Captain changes</div><div className="v num">{s.captainChanges}</div><div className="s">{s.avgCaptainRank ? `your picks rank #${s.avgCaptainRank} on average` : ''}</div></div>
            <div className="tile"><div className="k">Where you lean</div><div className="v" style={{ fontSize: 17 }}>{d.flows[0] ? d.flows[0].flow.replace('BAT', 'batter').replace('BOWL', 'bowler').replace('AR', 'all-rounder').replace('WK', 'keeper') : '–'}</div><div className="s">{d.flows[0] ? `${d.flows[0].n} swap${d.flows[0].n === 1 ? '' : 's'}` : ''}</div></div>
          </div>
          {d.matches.filter((m: any) => m.swaps.length || m.captain).map((m: any) => (
            <div key={m.match} className="card" style={{ marginTop: 10 }}>
              <b>{m.match}</b> <span className="sub">· kept {m.kept} of {m.size} of the agent's XI</span>
              {m.swaps.map((x: any, i: number) => (
                <div key={i} className="bt-find ok" style={{ marginTop: 6 }}>
                  Replaced <b>{x.from}</b> ({x.fromRole}, {x.fromXp} xP) with <b>{x.to}</b> ({x.toRole}, {x.toXp} xP) · <span className={`tag ${x.tag}`}>{x.tag}</span>{x.reason ? ` · ${x.reason}` : ''}
                  {x.fromActual !== null && x.toActual !== null && <span className="sub"> · actual {x.fromActual} vs {x.toActual}: {x.toActual > x.fromActual ? 'your pick was better' : 'the agent was better'}</span>}
                </div>
              ))}
              {m.captain && <div className="bt-find ok" style={{ marginTop: 6 }}>Captain: <b>{m.captain.from}</b> to <b>{m.captain.to}</b> (#{m.captain.rankInAgentList ?? '?'} on the agent's list) · <span className={`tag ${m.captain.tag}`}>{m.captain.tag}</span></div>}
            </div>
          ))}
        </>
      )}

      <div className="card" style={{ marginTop: 10 }}>
        <b>How your style gets into the agent</b>
        <ul className="bt-notes" style={{ lineHeight: 1.6, marginTop: 6 }}>
          <li>The agent never changes silently. When you repeat the same kind of override, it offers a playbook rule and you decide.</li>
          <li>Playbook rules are read by Gemini on every build, and a rule can say whose judgement wins (yours or the agent's) in a situation.</li>
          <li>Once results are in, Insights compares your picks and the agent's pick by pick, so the rule you add is backed by what actually scored.</li>
        </ul>
        {d.suggestion && (
          <Banner kind="warn">
            <b>Suggested rule: {d.suggestion.situation}.</b> {d.suggestion.evidence} <div className="sub">“{d.suggestion.rule}”</div>
            <button className="btn sm primary" style={{ marginTop: 8 }} onClick={adopt}>Add this to my playbook</button>
          </Banner>
        )}
        {d.rules.length > 0 && <div className="sub">Active playbook rules: {d.rules.map((r: any) => `${r.situation} (${r.owner})`).join(' · ')}</div>}
      </div>
      {toast}
    </>
  );
}
