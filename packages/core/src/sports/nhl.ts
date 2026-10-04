// HOCKEY — the NHL definition.
//
// Two populations, like K/DST in football: skaters and goalies carry
// different lines, and a goalie's stats sign the other way (goals against
// cost points). Both live in one StatLine; the groups tell a settings UI and
// the category engine which half applies to whom.
//
// api-web.nhle.com's box score carries G, A, +/-, PIM, SOG, HIT, BLK, PPG,
// faceoffs and TOI per skater; PPA/PPP, SHG/SHP and the game-winner are read
// off the landing page's scoring summary by the adapter (server/src/sports/
// nhl.js). Goalie W/L/OTL is the box score's `decision`.
//
// Scoring default is Yahoo's standard points league: G 6, A 4, +/- 2, PPP 2,
// SOG 0.9, BLK 1; goalies W 5, GA −3, SV 0.6, SHO 5. ESPN's is another preset
// (G 2, A 1, SOG/HIT 0.1, BLK 0.5, W 4, OTL 1, SO 3, SV 0.2, GA −2).
import type { SportDef, StatLine, StatDef, CategoryDef, SportSlotType } from './types';

const SKATERS = ['C', 'LW', 'RW', 'D'];
const GOALIES = ['G'];
const NHL_POSITIONS = [...SKATERS, ...GOALIES];

export const NHL_STATS: StatDef[] = [
  { id: 'gp', label: 'Games played', short: 'GP', group: 'skater' },
  { id: 'toi', label: 'Time on ice (min)', short: 'TOI', group: 'skater' },
  { id: 'g', label: 'Goals', short: 'G', group: 'skater' },
  { id: 'a', label: 'Assists', short: 'A', group: 'skater' },
  { id: 'pts', label: 'Points', short: 'PTS', group: 'skater', derived: true },
  { id: 'pm', label: 'Plus/minus', short: '+/-', group: 'skater' },
  { id: 'pim', label: 'Penalty minutes', short: 'PIM', group: 'skater' },
  { id: 'sog', label: 'Shots on goal', short: 'SOG', group: 'skater' },
  { id: 'hit', label: 'Hits', short: 'HIT', group: 'skater' },
  { id: 'blk', label: 'Blocked shots', short: 'BLK', group: 'skater' },
  { id: 'ppg', label: 'Power-play goals', short: 'PPG', group: 'skater' },
  { id: 'ppa', label: 'Power-play assists', short: 'PPA', group: 'skater' },
  { id: 'ppp', label: 'Power-play points', short: 'PPP', group: 'skater', derived: true },
  { id: 'shg', label: 'Short-handed goals', short: 'SHG', group: 'skater' },
  { id: 'sha', label: 'Short-handed assists', short: 'SHA', group: 'skater' },
  { id: 'shp', label: 'Short-handed points', short: 'SHP', group: 'skater', derived: true },
  { id: 'gwg', label: 'Game-winning goals', short: 'GWG', group: 'skater' },
  { id: 'fow', label: 'Faceoffs won', short: 'FOW', group: 'skater' },
  { id: 'fol', label: 'Faceoffs lost', short: 'FOL', group: 'skater' },
  { id: 'gva', label: 'Giveaways', short: 'GVA', group: 'skater' },
  { id: 'tka', label: 'Takeaways', short: 'TKA', group: 'skater' },
  { id: 'gapp', label: 'Goalie appearances', short: 'GA-GP', group: 'goalie' },
  { id: 'gs', label: 'Goalie starts', short: 'GS', group: 'goalie' },
  { id: 'gtoi', label: 'Goalie minutes', short: 'GMIN', group: 'goalie' },
  { id: 'w', label: 'Wins', short: 'W', group: 'goalie' },
  { id: 'l', label: 'Losses', short: 'L', group: 'goalie' },
  { id: 'otl', label: 'Overtime losses', short: 'OTL', group: 'goalie' },
  { id: 'ga', label: 'Goals against', short: 'GA', group: 'goalie' },
  { id: 'sv', label: 'Saves', short: 'SV', group: 'goalie' },
  { id: 'sa', label: 'Shots against', short: 'SA', group: 'goalie' },
  { id: 'so', label: 'Shutouts', short: 'SHO', group: 'goalie' },
];

export function deriveHockey(line: StatLine): StatLine {
  const g = line.g ?? 0, a = line.a ?? 0;
  return {
    ...line,
    pts: g + a,
    ppp: (line.ppg ?? 0) + (line.ppa ?? 0),
    shp: (line.shg ?? 0) + (line.sha ?? 0),
  };
}

export const NHL_CATEGORIES: CategoryDef[] = [
  { id: 'g', label: 'Goals', short: 'G', group: 'skater', stat: 'g' },
  { id: 'a', label: 'Assists', short: 'A', group: 'skater', stat: 'a' },
  { id: 'pts', label: 'Points', short: 'PTS', group: 'skater', stat: 'pts' },
  { id: 'pm', label: 'Plus/minus', short: '+/-', group: 'skater', stat: 'pm' },
  { id: 'pim', label: 'Penalty minutes', short: 'PIM', group: 'skater', stat: 'pim' },
  { id: 'ppp', label: 'Power-play points', short: 'PPP', group: 'skater', stat: 'ppp' },
  { id: 'shp', label: 'Short-handed points', short: 'SHP', group: 'skater', stat: 'shp' },
  { id: 'gwg', label: 'Game-winning goals', short: 'GWG', group: 'skater', stat: 'gwg' },
  { id: 'sog', label: 'Shots on goal', short: 'SOG', group: 'skater', stat: 'sog' },
  { id: 'hit', label: 'Hits', short: 'HIT', group: 'skater', stat: 'hit' },
  { id: 'blk', label: 'Blocked shots', short: 'BLK', group: 'skater', stat: 'blk' },
  { id: 'fow', label: 'Faceoffs won', short: 'FOW', group: 'skater', stat: 'fow' },
  { id: 'w', label: 'Wins', short: 'W', group: 'goalie', stat: 'w' },
  { id: 'ga', label: 'Goals against', short: 'GA', group: 'goalie', stat: 'ga', lowerBetter: true },
  { id: 'gaa', label: 'Goals-against average', short: 'GAA', group: 'goalie', ratio: { num: 'ga', den: 'gtoi', scale: 60, decimals: 2 }, lowerBetter: true },
  { id: 'sv', label: 'Saves', short: 'SV', group: 'goalie', stat: 'sv' },
  { id: 'svpct', label: 'Save %', short: 'SV%', group: 'goalie', ratio: { num: 'sv', den: 'sa', decimals: 3 } },
  { id: 'so', label: 'Shutouts', short: 'SHO', group: 'goalie', stat: 'so' },
];

const NHL_POS_MAP: Record<string, string[]> = {
  C: ['C'], L: ['LW'], LW: ['LW'], R: ['RW'], RW: ['RW'], D: ['D'], G: ['G'], F: ['C', 'LW', 'RW'],
};

const NHL_SLOTS: SportSlotType[] = [
  { type: 'C', label: 'C', pos: ['C'] },
  { type: 'LW', label: 'LW', pos: ['LW'] },
  { type: 'RW', label: 'RW', pos: ['RW'] },
  { type: 'F', label: 'F (C/LW/RW)', pos: ['C', 'LW', 'RW'] },
  { type: 'W', label: 'W (LW/RW)', pos: ['LW', 'RW'] },
  { type: 'D', label: 'D', pos: ['D'] },
  { type: 'UTIL', label: 'UTIL (skater)', pos: SKATERS },
  { type: 'G', label: 'G', pos: ['G'] },
];

export const NHL: SportDef = {
  id: 'nhl',
  label: 'Hockey',
  league: 'NHL',
  period: 'daily',
  positions: NHL_POSITIONS,
  posMap: NHL_POS_MAP,
  groups: { skater: SKATERS, goalie: GOALIES },
  slotTypes: NHL_SLOTS,
  // Yahoo's standard: 2C 2LW 2RW 4D 2G, 4 BN, 2 IR.
  defaultRoster: { C: 2, LW: 2, RW: 2, D: 4, G: 2 },
  benchDefault: 4,
  irDefault: 2,
  stats: NHL_STATS,
  derive: deriveHockey,
  scoringDefault: { g: 6, a: 4, pm: 2, ppp: 2, sog: 0.9, blk: 1, w: 5, ga: -3, sv: 0.6, so: 5 },
  categories: NHL_CATEGORIES,
  categoriesDefault: ['g', 'a', 'pm', 'pim', 'ppp', 'sog', 'hit', 'blk', 'w', 'gaa', 'svpct', 'so'],
  injuryStatuses: [
    { code: 'O', label: 'Out', out: true },
    { code: 'DTD', label: 'Day-to-day', out: false },
    { code: 'IR', label: 'Injured reserve', out: true },
    { code: 'LTIR', label: 'Long-term IR', out: true },
    { code: 'SUSP', label: 'Suspended', out: true },
  ],
  teams: 32,
  gamesPerTeam: 84,
  regularSeasonWeeks: 27,
  keyPrefix: 'nhl',
  vocab: { start: 'puck drop', starts: 'drops the puck', started: 'dropped the puck', slate: 'NHL SLATE', noGame: 'no game today' },
};
