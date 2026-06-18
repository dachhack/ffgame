import type { Pos, FxKey } from './theme';

export type { Pos, FxKey };

export type WindowId = 'tnf' | 'early' | 'late' | 'snf' | 'mnf';

export interface GameWindow {
  id: WindowId;
  label: string;
  sub: string;
  slots: number;
  time: string;
}

export interface PlayerStats {
  games: number;
  passYds: number;
  passTds: number;
  ints: number;
  carries: number;
  rushYds: number;
  rushTds: number;
  targets: number;
  receptions: number;
  recYds: number;
  recTds: number;
  ppr: number;
}

export interface Player {
  id: string;
  name: string;      // short display, e.g. "C. McCaffrey"
  full: string;      // full name
  pos: Pos;
  team: string;      // NFL team
  stats: PlayerStats; // per-season totals
}

export interface Metric {
  id: string;
  name: string;
  tag: string;          // short effect label
  fx: FxKey;            // effect family (drives accent color)
  sc: string;           // scoring summary
  ef: string;           // full effect description (tooltip)
}

export interface RosterEntry {
  playerId: string;
  starter: boolean;
}

export interface FantasyTeam {
  id: string;          // roster slug
  name: string;        // team name
  owner: string;       // manager handle
  ownerId: string;
  seed: number;        // final standings rank
  wins: number;
  losses: number;
  pf: number;
  pa: number;
  roster: string[];    // player ids
}

export interface ScheduleGame {
  week: number;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
}

export interface League {
  id: string;
  name: string;
  format: string;      // "Dynasty · 2QB · 10-team"
  season: number;
  teams: FantasyTeam[];
  schedule: ScheduleGame[];
}

// ---- Live simulation shapes ----

export type EffectType = 'nuke' | 'erase' | 'streak' | 'cold' | 'mult' | 'compression' | 'reset' | 'stop';

export interface PbpEvent {
  clock: number;            // game seconds elapsed (0..3300)
  side: 'you' | 'their';
  play: string;
  delta: number;            // points added by this play (pre-effect)
  youBank: number;          // running bank for your side after this event
  theirBank: number;        // running bank for their side after this event
  effect?: { type: EffectType; text: string };
  sig?: boolean;            // a "signature" play (drip economy: +5 coin to the acting side)
  drip?: boolean;           // a per-minute drip-accrual tick (hidden unless the log is expanded to minutes)
  mult?: number;            // QB Field General multiplier in effect for this play (×N), for the log
  // for rate/drip bars
  youRate?: number;
  theirRate?: number;
}

export interface SlotResolution {
  events: PbpEvent[];
  youFinal: number;
  theirFinal: number;
}

export interface Pick {
  playerId: string;
  metricId: string | null;
}
