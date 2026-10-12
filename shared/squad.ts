/** Helpers for the one-table squad screen (pure, so they can be tested). */
export interface SquadRow {
  name: string;
  team: string;
  inXI: boolean;
}

export const XI_SIZE = 11;

export function countsByTeam(rows: SquadRow[], teams: [string, string]): [number, number] {
  return [rows.filter((r) => r.team === teams[0] && r.inXI).length, rows.filter((r) => r.team === teams[1] && r.inXI).length];
}

/**
 * Default XI after reading a Dream11 screenshot: the players it lists as probable ("Played Last Match").
 * If a team's probable list isn't a usable size (0, or more than 11), nobody from that team is pre-selected,
 * so Aryan ticks the XI himself instead of getting a wrong default.
 */
export function defaultXI<T extends { team: string; probable?: boolean }>(rows: T[], teams: [string, string]): boolean[] {
  const ok = new Map<string, boolean>();
  for (const t of teams) {
    const n = rows.filter((r) => r.team === t && r.probable).length;
    ok.set(t, n >= 1 && n <= XI_SIZE);
  }
  return rows.map((r) => !!r.probable && ok.get(r.team) === true);
}

export type Readiness = { ok: boolean; level: 'ok' | 'warn' | 'bad'; message: string };

/** Can this squad be built? Warn (but allow) if a side has fewer than 11. */
export function readiness(rows: SquadRow[], teams: [string, string]): Readiness {
  const [a, b] = countsByTeam(rows, teams);
  const total = a + b;
  if (rows.filter((r) => r.name.trim()).length < XI_SIZE) return { ok: false, level: 'bad', message: 'Add the players first (upload a screenshot or type them).' };
  if (total < XI_SIZE) return { ok: false, level: 'bad', message: `Tick the playing XI: ${total} selected, at least ${XI_SIZE} needed.` };
  if (a < XI_SIZE || b < XI_SIZE) return { ok: true, level: 'warn', message: `${teams[0]} ${a} · ${teams[1]} ${b}. A full side has 11, but you can continue.` };
  return { ok: true, level: 'ok', message: `${teams[0]} ${a} · ${teams[1]} ${b}. Ready to build.` };
}
