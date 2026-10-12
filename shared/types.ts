export type Role = 'WK' | 'BAT' | 'AR' | 'BOWL';
export const ROLES: Role[] = ['WK', 'BAT', 'AR', 'BOWL']; // Dream11 tab order
export type ContestType = 'small' | 'grand';
export type Stage = 'pre_toss' | 'final';
export type PitchType = 'batting_friendly' | 'pace_friendly' | 'spin_friendly' | 'slow_low' | 'balanced';

export interface Rules {
  credit_cap: number;
  team_size: number;
  role_min: Record<Role, number>;
  role_max: Record<Role, number>;
  max_per_team: number;
  captain_mult: number;
  vc_mult: number;
}

export interface Candidate {
  key: string;
  name: string;
  team: string;
  role: Role;
  credit: number;
  xp: number;
}

export interface MatchXI {
  teamA: string[];
  teamB: string[];
  impact: string[];
  confirmed: boolean;
  source: 'api' | 'manual' | 'probable' | 'announced';
}

export interface Recommended {
  xi: string[];
  captain: string;
  vc: string;
  captain_reason: string;
  bench: { key: string; reason: string }[];
  total_xp: number;
  credits: number;
  cvc_source: 'gemini' | 'guarded' | 'fallback';
  credit_mode?: 'applied' | 'ignored';
}

export interface FinalTeam {
  xi: string[];
  captain: string;
  vc: string;
}

export type DecisionTag = 'gut' | 'reasoned';
export interface DecisionEntry {
  kind: 'swap' | 'captain' | 'vice';
  from: string;
  to: string;
  tag: DecisionTag;
  reason?: string;
}
