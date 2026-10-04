// BASKETBALL — the NBA definition, and the base the WNBA one is cut from.
//
// Stat ids follow the box score every basketball feed publishes (cdn.nba.com
// liveData, ESPN, Yahoo all agree on this set). Ratio stats (FG%, FT%) are
// categories, not stats. Double- and triple-doubles are derived.
//
// Scoring default is Yahoo's standard points league (PTS 1, REB 1.2, AST 1.5,
// STL 3, BLK 3, TO −1). ESPN's default is a different preset (FGM 2, FGA −1,
// FTM 1, FTA −1, PTS 1, 3PM 1, REB 1, AST 2, STL 4, BLK 4, TO −2); both are a
// commissioner's knob edit away. 9-cat is the categories default.
import type { SportDef, StatLine, StatDef, CategoryDef, SportSlotType } from './types';

export const BASKETBALL_STATS: StatDef[] = [
  { id: 'gp', label: 'Games played', short: 'GP', group: 'all' },
  { id: 'min', label: 'Minutes', short: 'MIN', group: 'all' },
  { id: 'pts', label: 'Points', short: 'PTS', group: 'all' },
  { id: 'fgm', label: 'Field goals made', short: 'FGM', group: 'all' },
  { id: 'fga', label: 'Field goals attempted', short: 'FGA', group: 'all' },
  { id: 'ftm', label: 'Free throws made', short: 'FTM', group: 'all' },
  { id: 'fta', label: 'Free throws attempted', short: 'FTA', group: 'all' },
  { id: 'tpm', label: 'Three-pointers made', short: '3PM', group: 'all' },
  { id: 'tpa', label: 'Three-pointers attempted', short: '3PA', group: 'all' },
  { id: 'oreb', label: 'Offensive rebounds', short: 'OREB', group: 'all' },
  { id: 'dreb', label: 'Defensive rebounds', short: 'DREB', group: 'all' },
  { id: 'reb', label: 'Rebounds', short: 'REB', group: 'all' },
  { id: 'ast', label: 'Assists', short: 'AST', group: 'all' },
  { id: 'stl', label: 'Steals', short: 'STL', group: 'all' },
  { id: 'blk', label: 'Blocks', short: 'BLK', group: 'all' },
  { id: 'tov', label: 'Turnovers', short: 'TO', group: 'all' },
  { id: 'pf', label: 'Personal fouls', short: 'PF', group: 'all' },
  { id: 'dd', label: 'Double-doubles', short: 'DD', group: 'all', derived: true },
  { id: 'td', label: 'Triple-doubles', short: 'TD', group: 'all', derived: true },
];

/** A double-double is 10+ in two of PTS/REB/AST/STL/BLK; a triple-double in
 *  three. Counted on the line as given, so a summed line (a week) does NOT
 *  yield a week-long "double-double" — callers derive per game. */
export function deriveBasketball(line: StatLine): StatLine {
  const tens = ['pts', 'reb', 'ast', 'stl', 'blk'].filter((k) => (line[k] ?? 0) >= 10).length;
  return { ...line, dd: tens >= 2 ? 1 : 0, td: tens >= 3 ? 1 : 0 };
}

export const BASKETBALL_CATEGORIES: CategoryDef[] = [
  { id: 'pts', label: 'Points', short: 'PTS', group: 'all', stat: 'pts' },
  { id: 'reb', label: 'Rebounds', short: 'REB', group: 'all', stat: 'reb' },
  { id: 'ast', label: 'Assists', short: 'AST', group: 'all', stat: 'ast' },
  { id: 'stl', label: 'Steals', short: 'STL', group: 'all', stat: 'stl' },
  { id: 'blk', label: 'Blocks', short: 'BLK', group: 'all', stat: 'blk' },
  { id: 'tpm', label: 'Three-pointers', short: '3PM', group: 'all', stat: 'tpm' },
  { id: 'fgpct', label: 'Field goal %', short: 'FG%', group: 'all', ratio: { num: 'fgm', den: 'fga', decimals: 3 } },
  { id: 'ftpct', label: 'Free throw %', short: 'FT%', group: 'all', ratio: { num: 'ftm', den: 'fta', decimals: 3 } },
  { id: 'tov', label: 'Turnovers', short: 'TO', group: 'all', stat: 'tov', lowerBetter: true },
  { id: 'oreb', label: 'Offensive rebounds', short: 'OREB', group: 'all', stat: 'oreb' },
  { id: 'dd', label: 'Double-doubles', short: 'DD', group: 'all', stat: 'dd' },
  { id: 'td', label: 'Triple-doubles', short: 'TD', group: 'all', stat: 'td' },
  { id: 'tppct', label: 'Three-point %', short: '3P%', group: 'all', ratio: { num: 'tpm', den: 'tpa', decimals: 3 } },
  { id: 'ato', label: 'Assist/turnover', short: 'A/T', group: 'all', ratio: { num: 'ast', den: 'tov', decimals: 2 } },
];

export const NINE_CAT = ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'fgpct', 'ftpct', 'tov'];

const NBA_POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

// cdn.nba.com writes a single code per player ("G", "F-C"); the platforms
// assign eligibility per player. Until a per-player eligibility source exists
// the feed code widens to every position it could mean.
const NBA_POS_MAP: Record<string, string[]> = {
  PG: ['PG'], SG: ['SG'], SF: ['SF'], PF: ['PF'], C: ['C'],
  G: ['PG', 'SG'], F: ['SF', 'PF'],
  'G-F': ['SG', 'SF'], 'F-G': ['SF', 'SG'], 'F-C': ['PF', 'C'], 'C-F': ['C', 'PF'],
};

const NBA_SLOTS: SportSlotType[] = [
  { type: 'PG', label: 'PG', pos: ['PG'] },
  { type: 'SG', label: 'SG', pos: ['SG'] },
  { type: 'G', label: 'G (PG/SG)', pos: ['PG', 'SG'] },
  { type: 'SF', label: 'SF', pos: ['SF'] },
  { type: 'PF', label: 'PF', pos: ['PF'] },
  { type: 'F', label: 'F (SF/PF)', pos: ['SF', 'PF'] },
  { type: 'C', label: 'C', pos: ['C'] },
  { type: 'UTIL', label: 'UTIL', pos: NBA_POSITIONS },
];

export const NBA_INJURY_STATUSES = [
  { code: 'O', label: 'Out', out: true },
  { code: 'D', label: 'Doubtful', out: false },
  { code: 'Q', label: 'Questionable', out: false },
  { code: 'P', label: 'Probable', out: false },
  { code: 'GTD', label: 'Game-time decision', out: false },
  { code: 'OFS', label: 'Out for season', out: true },
];

export const NBA: SportDef = {
  id: 'nba',
  label: 'Basketball',
  league: 'NBA',
  period: 'daily',
  positions: NBA_POSITIONS,
  posMap: NBA_POS_MAP,
  groups: { all: NBA_POSITIONS },
  slotTypes: NBA_SLOTS,
  // Yahoo's standard: PG SG G SF PF F C C UTIL UTIL (10 starters), 3 BN, 3 IL.
  defaultRoster: { PG: 1, SG: 1, G: 1, SF: 1, PF: 1, F: 1, C: 2, UTIL: 2 },
  benchDefault: 3,
  irDefault: 3,
  stats: BASKETBALL_STATS,
  derive: deriveBasketball,
  scoringDefault: { pts: 1, reb: 1.2, ast: 1.5, stl: 3, blk: 3, tov: -1 },
  categories: BASKETBALL_CATEGORIES,
  categoriesDefault: NINE_CAT,
  injuryStatuses: NBA_INJURY_STATUSES,
  teams: 30,
  gamesPerTeam: 82,
  regularSeasonWeeks: 24,
  keyPrefix: 'nba',
  vocab: { start: 'tip-off', starts: 'tips off', started: 'tipped off', slate: 'NBA SLATE', noGame: 'no game today' },
};
