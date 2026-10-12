import type { SupabaseClient } from '@supabase/supabase-js';
import { must } from '@/backend/integrations/supabase';
import { situationKey } from '@/backend/db/queries';

export const MIN_N = 8;

export interface EvalRow {
  match_id: string;
  key: string;
  name: string;
  role: string;
  position_bucket: string;
  venue: string;
  format: string;
  pitch: string;
  predicted: number;
  actual: number;
  date: string;
}

export interface GroupStat {
  dimension: string;
  label: string;
  n: number;
  bias: number; // predicted - actual, positive = model overrates
  mae: number;
  conclusive: boolean;
}

function bucket(pos: number | null): string {
  if (!pos) return 'unknown position';
  if (pos <= 2) return 'openers';
  if (pos <= 4) return 'top order';
  if (pos <= 6) return 'middle order';
  return 'lower order';
}

export async function evalRows(sb: SupabaseClient): Promise<EvalRow[]> {
  const preds = must(await sb.from('predictions').select('match_id,name_key,player_name,role,batting_position,expected_points'), 'predictions');
  const acts = must(await sb.from('actual_points').select('match_id,name_key,points'), 'actuals');
  const matches = must(await sb.from('matches').select('id,venue,format,context,starts_at'), 'matches');
  const actual = new Map(acts.map((a: any) => [`${a.match_id}|${a.name_key}`, Number(a.points)]));
  const mm = new Map(matches.map((m: any) => [m.id, m]));
  const rows: EvalRow[] = [];
  for (const p of preds as any[]) {
    const a = actual.get(`${p.match_id}|${p.name_key}`);
    const m: any = mm.get(p.match_id);
    if (a === undefined || !m) continue;
    rows.push({
      match_id: p.match_id,
      key: p.name_key,
      name: p.player_name,
      role: p.role,
      position_bucket: bucket(p.batting_position),
      venue: m.venue ?? 'unknown venue',
      format: m.format ?? 'T20',
      pitch: (m.context?.pitch_type ?? 'unknown').replace(/_/g, ' '),
      predicted: Number(p.expected_points),
      actual: a,
      date: m.starts_at ?? '',
    });
  }
  return rows;
}

export function groupStats(rows: EvalRow[]): GroupStat[] {
  const dims: [string, (r: EvalRow) => string][] = [
    ['venue', (r) => r.venue],
    ['role', (r) => r.role],
    ['batting position', (r) => r.position_bucket],
    ['pitch type', (r) => r.pitch],
    ['format', (r) => r.format],
    ['role on pitch type', (r) => situationKey(r.role, r.pitch.replace(/ /g, '_'))],
    ['position on pitch type', (r) => `${r.position_bucket} · ${r.pitch}`],
  ];
  const out: GroupStat[] = [];
  for (const [dimension, f] of dims) {
    const g = new Map<string, EvalRow[]>();
    for (const r of rows) g.set(f(r), [...(g.get(f(r)) ?? []), r]);
    for (const [label, rs] of g) {
      const errs = rs.map((r) => r.predicted - r.actual);
      out.push({
        dimension,
        label,
        n: rs.length,
        bias: errs.reduce((s, x) => s + x, 0) / rs.length,
        mae: errs.reduce((s, x) => s + Math.abs(x), 0) / rs.length,
        conclusive: rs.length >= MIN_N,
      });
    }
  }
  return out;
}

export function plainFindings(stats: GroupStat[]): string[] {
  return stats
    .filter((s) => s.conclusive && Math.abs(s.bias) >= 3)
    .sort((a, b) => Math.abs(b.bias) - Math.abs(a.bias))
    .slice(0, 6)
    .map((s) => {
      const dir = s.bias > 0 ? 'overrating' : 'underrating';
      const subject = s.dimension === 'venue' ? `players at ${s.label}` : s.dimension === 'format' ? `${s.label} matches` : s.label;
      return `The agent is ${dir} ${subject} by ${Math.abs(s.bias).toFixed(1)} points per player (${s.n} data points).`;
    });
}

export function errorOverTime(rows: EvalRow[]) {
  const g = new Map<string, EvalRow[]>();
  for (const r of rows) g.set(r.match_id, [...(g.get(r.match_id) ?? []), r]);
  return [...g.values()]
    .map((rs) => ({
      match_id: rs[0].match_id,
      date: rs[0].date,
      mae: rs.reduce((s, r) => s + Math.abs(r.predicted - r.actual), 0) / rs.length,
      bias: rs.reduce((s, r) => s + (r.predicted - r.actual), 0) / rs.length,
      n: rs.length,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

interface DecisionRow {
  match_id: string;
  recommended: any;
  final: any;
  decisions: any[];
  status: string;
}

export async function scoreboardAndCvc(sb: SupabaseClient) {
  const decisions = must(await sb.from('team_decisions').select('match_id,recommended,final,decisions,status'), 'decisions') as DecisionRow[];
  const acts = must(await sb.from('actual_points').select('match_id,name_key,points'), 'actuals');
  const matches = must(await sb.from('matches').select('id,context,name'), 'matches');
  const preds = must(await sb.from('predictions').select('match_id,name_key,role'), 'preds');
  const roleOf = new Map((preds as any[]).map((p) => [`${p.match_id}|${p.name_key}`, p.role]));
  const pts = new Map((acts as any[]).map((a) => [`${a.match_id}|${a.name_key}`, Number(a.points)]));
  const mm = new Map((matches as any[]).map((m) => [m.id, m]));

  const board = new Map<string, { situation: string; n: number; agent: number; aryan: number }>();
  const bump = (situation: string, agent: number, aryan: number) => {
    const c = board.get(situation) ?? { situation, n: 0, agent: 0, aryan: 0 };
    c.n++;
    c.agent += agent;
    c.aryan += aryan;
    board.set(situation, c);
  };
  const tagStats = { gut: { n: 0, aryanWins: 0 }, reasoned: { n: 0, aryanWins: 0 } };
  const cvc: { match: string; agentHit: boolean | null; aryanHit: boolean | null }[] = [];

  for (const d of decisions) {
    const mid = d.match_id;
    const scored = [...pts].filter(([k]) => k.startsWith(`${mid}|`));
    if (!scored.length) continue;
    const top3 = new Set(scored.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k]) => k.split('|')[1]));
    cvc.push({
      match: (mm.get(mid) as any)?.name ?? mid,
      agentHit: d.recommended?.captain ? top3.has(d.recommended.captain) : null,
      aryanHit: d.final?.captain ? top3.has(d.final.captain) : null,
    });
    const pitch = (mm.get(mid) as any)?.context?.pitch_type;
    for (const e of d.decisions ?? []) {
      const tag = e.tag as 'gut' | 'reasoned';
      if (e.kind === 'swap') {
        const a = pts.get(`${mid}|${e.from}`);
        const b = pts.get(`${mid}|${e.to}`);
        if (a === undefined || b === undefined) continue;
        bump(situationKey(roleOf.get(`${mid}|${e.to}`) ?? '?', pitch), a, b);
        if (tagStats[tag]) { tagStats[tag].n++; if (b > a) tagStats[tag].aryanWins++; }
      } else {
        const a = pts.get(`${mid}|${e.from}`);
        const b = pts.get(`${mid}|${e.to}`);
        if (a === undefined || b === undefined) continue;
        const mult = e.kind === 'captain' ? 2 : 1.5;
        bump(e.kind === 'captain' ? 'Captaincy' : 'Vice-captaincy', a * mult, b * mult);
        if (tagStats[tag]) { tagStats[tag].n++; if (b > a) tagStats[tag].aryanWins++; }
      }
    }
  }
  const hit = (k: 'agentHit' | 'aryanHit') => {
    const v = cvc.filter((c) => c[k] !== null);
    return { hits: v.filter((c) => c[k]).length, total: v.length };
  };
  return {
    scoreboard: [...board.values()].map((s) => ({ ...s, agent: Math.round(s.agent * 10) / 10, aryan: Math.round(s.aryan * 10) / 10 })).sort((a, b) => b.n - a.n),
    tagStats,
    cvcHitRate: { agent: hit('agentHit'), aryan: hit('aryanHit'), matches: cvc },
  };
}

/** Situations Aryan has overridden >= 3 times with no playbook rule yet: the agent asks, never adds silently. */
export async function playbookNudges(sb: SupabaseClient): Promise<{ situation: string; count: number }[]> {
  const decisions = must(await sb.from('team_decisions').select('match_id,decisions,situation_keys').eq('status', 'final'), 'decisions') as any[];
  const rules = must(await sb.from('playbook_rules').select('situation').eq('active', true), 'rules') as { situation: string }[];
  const have = rules.map((r) => r.situation.toLowerCase());
  const counts = new Map<string, number>();
  for (const d of decisions) for (const s of d.situation_keys ?? []) counts.set(s, (counts.get(s) ?? 0) + 1);
  return [...counts]
    .filter(([s, c]) => c >= 3 && !have.includes(s.toLowerCase()))
    .map(([situation, count]) => ({ situation, count }))
    .sort((a, b) => b.count - a.count);
}
