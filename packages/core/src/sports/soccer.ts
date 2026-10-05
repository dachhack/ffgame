// SOCCER — one definition for two leagues (v0.630.0): the Premier League
// (`epl`) and MLS (`mls`), as basketball is one vocabulary for the NBA and
// the WNBA. Built ahead of the data: Stathead is adding both leagues to its
// delivery (docs/multi-sport-plan.md), so the product is ready when the
// first match lines land.
//
// WHAT IS DIFFERENT ABOUT SOCCER. Fantasy soccer pays by position — a
// defender's goal and clean sheet are worth more than a forward's, a keeper's
// saves count in threes — and our scoring table is flat (one number per stat
// id). So every match line carries the player's position for that match as
// `posn` (1 GK, 2 DEF, 3 MID, 4 FWD; the adapter sets it from the box score,
// never the directory, because listed positions change between seasons) and
// derive() splits goals and clean sheets by position into their own stat
// ids. A clean sheet needs 60 minutes on the pitch (the FPL rule); the raw
// `cs` is the team fact (the side conceded none while he was on).
//
// THE WEEK. A Premier League matchweek runs Saturday to Monday night, so
// soccer periods run Tuesday to Monday (`weekStartDow` 2) rather than
// Monday to Sunday; the period arithmetic is anchor-agnostic and only the
// first day moves (league.ts periodStartOnOrBefore).
//
// Defaults are the Fantasy Premier League table: appearance 1 (+1 from 60
// minutes), goals GK/DEF 6, MID 5, FWD 4, assist 3, clean sheet GK/DEF 4,
// MID 1, every 3 saves 1, penalty save 5, penalty miss −2, every 2 goals
// conceded (GK/DEF) −1, yellow −1, red −3, own goal −2. Draft leagues
// (Fantrax-style) add tackles, interceptions, key passes and shots on target
// as knobs; they are here at 0 for the commissioner to price.
import type { Sport, SportDef, StatLine, StatDef, CategoryDef, SportSlotType } from './types';

const OUTFIELD = ['DEF', 'MID', 'FWD'];
const KEEPER = ['GK'];
export const SOCCER_POSITIONS = [...KEEPER, ...OUTFIELD];

/** `posn` codes a match line carries. */
export const SOCCER_POSN: Record<string, number> = { GK: 1, DEF: 2, MID: 3, FWD: 4 };

export const SOCCER_STATS: StatDef[] = [
  { id: 'gp', label: 'Appearances', short: 'APP', group: 'all' },
  { id: 'min', label: 'Minutes', short: 'MIN', group: 'all' },
  { id: 'start', label: 'Starts', short: 'ST', group: 'all' },
  { id: 'app', label: 'Appearance (under 60 min)', short: 'APP<60', group: 'all', derived: true },
  { id: 'app60', label: 'Appearance (60+ min)', short: 'APP60', group: 'all', derived: true },
  { id: 'g', label: 'Goals', short: 'G', group: 'all' },
  { id: 'g_gk', label: 'Goals by a goalkeeper', short: 'G (GK)', group: 'keeper', derived: true },
  { id: 'g_def', label: 'Goals by a defender', short: 'G (DEF)', group: 'outfielder', derived: true },
  { id: 'g_mid', label: 'Goals by a midfielder', short: 'G (MID)', group: 'outfielder', derived: true },
  { id: 'g_fwd', label: 'Goals by a forward', short: 'G (FWD)', group: 'outfielder', derived: true },
  { id: 'a', label: 'Assists', short: 'A', group: 'all' },
  { id: 'sh', label: 'Shots', short: 'SH', group: 'all' },
  { id: 'sot', label: 'Shots on target', short: 'SOT', group: 'all' },
  { id: 'kp', label: 'Key passes', short: 'KP', group: 'all' },
  { id: 'bc', label: 'Big chances created', short: 'BC', group: 'all' },
  { id: 'tkl', label: 'Tackles won', short: 'TKL', group: 'all' },
  { id: 'int', label: 'Interceptions', short: 'INT', group: 'all' },
  { id: 'clr', label: 'Clearances', short: 'CLR', group: 'all' },
  { id: 'blk', label: 'Blocks', short: 'BLK', group: 'all' },
  { id: 'cs', label: 'Clean sheet (team)', short: 'CS', group: 'all' },
  { id: 'cs_gk', label: 'Clean sheet, goalkeeper (60+ min)', short: 'CS (GK)', group: 'keeper', derived: true },
  { id: 'cs_def', label: 'Clean sheet, defender (60+ min)', short: 'CS (DEF)', group: 'outfielder', derived: true },
  { id: 'cs_mid', label: 'Clean sheet, midfielder (60+ min)', short: 'CS (MID)', group: 'outfielder', derived: true },
  { id: 'gc', label: 'Goals conceded while on', short: 'GC', group: 'all' },
  { id: 'gc2', label: 'Every 2 goals conceded (GK/DEF)', short: 'GC/2', group: 'all', derived: true },
  { id: 'sv', label: 'Saves', short: 'SV', group: 'keeper' },
  { id: 'sv3', label: 'Every 3 saves', short: 'SV/3', group: 'keeper', derived: true },
  { id: 'ps', label: 'Penalties saved', short: 'PS', group: 'keeper' },
  { id: 'pm', label: 'Penalties missed', short: 'PM', group: 'all' },
  { id: 'pw', label: 'Penalties won', short: 'PW', group: 'all' },
  { id: 'pc', label: 'Penalties conceded', short: 'PC', group: 'all' },
  { id: 'og', label: 'Own goals', short: 'OG', group: 'all' },
  { id: 'yc', label: 'Yellow cards', short: 'YC', group: 'all' },
  { id: 'rc', label: 'Red cards', short: 'RC', group: 'all' },
  { id: 'xg', label: 'Expected goals', short: 'xG', group: 'all' },
  { id: 'xa', label: 'Expected assists', short: 'xA', group: 'all' },
];

export function deriveSoccer(line: StatLine): StatLine {
  const min = line.min ?? 0, p = line.posn ?? 0, g = line.g ?? 0;
  const full = min >= 60 ? 1 : 0;
  const cs = (line.cs ?? 0) > 0 && full ? 1 : 0;
  return {
    ...line,
    app: min > 0 && !full ? 1 : 0,
    app60: full,
    g_gk: p === 1 ? g : 0, g_def: p === 2 ? g : 0, g_mid: p === 3 ? g : 0, g_fwd: p === 4 ? g : 0,
    cs_gk: p === 1 ? cs : 0, cs_def: p === 2 ? cs : 0, cs_mid: p === 3 ? cs : 0,
    gc2: p === 1 || p === 2 ? Math.floor((line.gc ?? 0) / 2) : 0,
    sv3: Math.floor((line.sv ?? 0) / 3),
  };
}

export const SOCCER_CATEGORIES: CategoryDef[] = [
  { id: 'g', label: 'Goals', short: 'G', group: 'all', stat: 'g' },
  { id: 'a', label: 'Assists', short: 'A', group: 'all', stat: 'a' },
  { id: 'sh', label: 'Shots', short: 'SH', group: 'all', stat: 'sh' },
  { id: 'sot', label: 'Shots on target', short: 'SOT', group: 'all', stat: 'sot' },
  { id: 'kp', label: 'Key passes', short: 'KP', group: 'all', stat: 'kp' },
  { id: 'bc', label: 'Big chances created', short: 'BC', group: 'all', stat: 'bc' },
  { id: 'tkl', label: 'Tackles won', short: 'TKL', group: 'all', stat: 'tkl' },
  { id: 'int', label: 'Interceptions', short: 'INT', group: 'all', stat: 'int' },
  { id: 'clr', label: 'Clearances', short: 'CLR', group: 'all', stat: 'clr' },
  { id: 'blk', label: 'Blocks', short: 'BLK', group: 'all', stat: 'blk' },
  { id: 'cs', label: 'Clean sheets', short: 'CS', group: 'all', stat: 'cs' },
  { id: 'min', label: 'Minutes', short: 'MIN', group: 'all', stat: 'min' },
  { id: 'sv', label: 'Saves', short: 'SV', group: 'keeper', stat: 'sv' },
  { id: 'gc', label: 'Goals conceded', short: 'GC', group: 'all', stat: 'gc', lowerBetter: true },
  { id: 'yc', label: 'Yellow cards', short: 'YC', group: 'all', stat: 'yc', lowerBetter: true },
  { id: 'rc', label: 'Red cards', short: 'RC', group: 'all', stat: 'rc', lowerBetter: true },
  { id: 'og', label: 'Own goals', short: 'OG', group: 'all', stat: 'og', lowerBetter: true },
  { id: 'shacc', label: 'Shot accuracy', short: 'SOT%', group: 'all', ratio: { num: 'sot', den: 'sh', decimals: 3 } },
];

const SOCCER_POS_MAP: Record<string, string[]> = {
  GK: ['GK'], G: ['GK'], GKP: ['GK'],
  DEF: ['DEF'], D: ['DEF'], CB: ['DEF'], LB: ['DEF'], RB: ['DEF'], WB: ['DEF'], LWB: ['DEF'], RWB: ['DEF'],
  MID: ['MID'], M: ['MID'], CM: ['MID'], DM: ['MID'], CDM: ['MID'], AM: ['MID'], CAM: ['MID'], LM: ['MID'], RM: ['MID'],
  FWD: ['FWD'], F: ['FWD'], FW: ['FWD'], ST: ['FWD'], CF: ['FWD'], LF: ['FWD'], RF: ['FWD'], SS: ['FWD'], LW: ['FWD'], RW: ['FWD'], W: ['FWD'],
  'D-M': ['DEF', 'MID'], 'M-F': ['MID', 'FWD'],
};

const SOCCER_SLOTS: SportSlotType[] = [
  { type: 'GK', label: 'GK', pos: ['GK'] },
  { type: 'DEF', label: 'DEF', pos: ['DEF'] },
  { type: 'MID', label: 'MID', pos: ['MID'] },
  { type: 'FWD', label: 'FWD', pos: ['FWD'] },
  { type: 'UTIL', label: 'UTIL (outfield)', pos: OUTFIELD },
];

export const SOCCER_INJURY_STATUSES = [
  { code: 'O', label: 'Out', out: true },
  { code: 'D', label: 'Doubtful', out: false },
  { code: 'Q', label: 'Questionable', out: false },
  { code: 'SUSP', label: 'Suspended', out: true },
  { code: 'OFS', label: 'Out for season', out: true },
];

function soccer(id: Sport, league: string, slate: string, teams: number, gamesPerTeam: number, regularSeasonWeeks: number): SportDef {
  return {
    id,
    label: 'Soccer',
    league,
    period: 'daily',
    positions: SOCCER_POSITIONS,
    posMap: SOCCER_POS_MAP,
    groups: { outfielder: OUTFIELD, keeper: KEEPER },
    slotTypes: SOCCER_SLOTS,
    // A draft-league standard: 1 GK, 3 DEF, 3 MID, 2 FWD, 2 UTIL = 11, 4 BN, 2 IR.
    defaultRoster: { GK: 1, DEF: 3, MID: 3, FWD: 2, UTIL: 2 },
    benchDefault: 4,
    irDefault: 2,
    stats: SOCCER_STATS,
    derive: deriveSoccer,
    scoringDefault: { app: 1, app60: 2, g_gk: 6, g_def: 6, g_mid: 5, g_fwd: 4, a: 3, cs_gk: 4, cs_def: 4, cs_mid: 1, sv3: 1, ps: 5, pm: -2, gc2: -1, yc: -1, rc: -3, og: -2 },
    categories: SOCCER_CATEGORIES,
    categoriesDefault: ['g', 'a', 'sot', 'kp', 'tkl', 'int', 'sv', 'cs', 'yc'],
    injuryStatuses: SOCCER_INJURY_STATUSES,
    teams,
    gamesPerTeam,
    regularSeasonWeeks,
    keyPrefix: id,
    weekStartDow: 2,
    vocab: { start: 'kick-off', starts: 'kicks off', started: 'kicked off', slate, noGame: 'no match today' },
  };
}

/** The Premier League: 20 clubs, 38 matches, August to May (season = starting year). */
export const EPL: SportDef = soccer('epl', 'Premier League', 'PL FIXTURES', 20, 38, 40);
/** MLS: 30 clubs, 34 matches, February to December (season = calendar year). */
export const MLS: SportDef = soccer('mls', 'MLS', 'MLS FIXTURES', 30, 34, 36);
