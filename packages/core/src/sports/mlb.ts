// BASEBALL — the MLB definition.
//
// Hitters and pitchers are the two populations. A pitcher's line is prefixed
// `p_` where a hitter has the same-named stat (a pitcher's strikeouts are the
// good kind), and innings are stored as OUTS — the only integer that sums.
// `ip` (outs/3) and the quality start are derived.
//
// Scoring default is the DraftKings-style points set every daily player
// knows (1B 3, 2B 5, 3B 8, HR 10, R 2, RBI 2, BB 2, HBP 2, SB 5; per out
// 0.75 = 2.25/IP, K 2, W 4, ER −2, H/BB/HBP −0.6, CG 2.5, SHO 2.5, no-hitter
// 5) with SV 5 and HLD 2 added, since a season-long league fields relievers.
// Categories default to classic 5x5 roto: R HR RBI SB AVG · W SV K ERA WHIP.
//
// The feed (statsapi.mlb.com) gives one primary position and the day's
// fielding positions per game; platform-style multi-eligibility (games at a
// position over a threshold) is phase 2 — see docs/multi-sport-plan.md.
import type { SportDef, StatLine, StatDef, CategoryDef, SportSlotType } from './types';

const HITTERS = ['C', '1B', '2B', '3B', 'SS', 'OF', 'DH'];
const PITCHERS = ['SP', 'RP'];
const MLB_POSITIONS = [...HITTERS, ...PITCHERS];

export const MLB_STATS: StatDef[] = [
  { id: 'hgp', label: 'Games (hitting)', short: 'GP', group: 'hitter' },
  { id: 'pa', label: 'Plate appearances', short: 'PA', group: 'hitter' },
  { id: 'ab', label: 'At bats', short: 'AB', group: 'hitter' },
  { id: 'h', label: 'Hits', short: 'H', group: 'hitter' },
  { id: '1b', label: 'Singles', short: '1B', group: 'hitter', derived: true },
  { id: '2b', label: 'Doubles', short: '2B', group: 'hitter' },
  { id: '3b', label: 'Triples', short: '3B', group: 'hitter' },
  { id: 'hr', label: 'Home runs', short: 'HR', group: 'hitter' },
  { id: 'r', label: 'Runs', short: 'R', group: 'hitter' },
  { id: 'rbi', label: 'Runs batted in', short: 'RBI', group: 'hitter' },
  { id: 'bb', label: 'Walks', short: 'BB', group: 'hitter' },
  { id: 'ibb', label: 'Intentional walks', short: 'IBB', group: 'hitter' },
  { id: 'hbp', label: 'Hit by pitch', short: 'HBP', group: 'hitter' },
  { id: 'k', label: 'Strikeouts', short: 'K', group: 'hitter' },
  { id: 'sb', label: 'Stolen bases', short: 'SB', group: 'hitter' },
  { id: 'cs', label: 'Caught stealing', short: 'CS', group: 'hitter' },
  { id: 'tb', label: 'Total bases', short: 'TB', group: 'hitter', derived: true },
  { id: 'sf', label: 'Sacrifice flies', short: 'SF', group: 'hitter' },
  { id: 'sh', label: 'Sacrifice bunts', short: 'SH', group: 'hitter' },
  { id: 'gidp', label: 'Double plays grounded into', short: 'GIDP', group: 'hitter' },
  { id: 'pgp', label: 'Games (pitching)', short: 'G', group: 'pitcher' },
  { id: 'gs', label: 'Games started', short: 'GS', group: 'pitcher' },
  { id: 'outs', label: 'Outs recorded', short: 'OUTS', group: 'pitcher' },
  { id: 'ip', label: 'Innings pitched', short: 'IP', group: 'pitcher', derived: true },
  { id: 'w', label: 'Wins', short: 'W', group: 'pitcher' },
  { id: 'l', label: 'Losses', short: 'L', group: 'pitcher' },
  { id: 'sv', label: 'Saves', short: 'SV', group: 'pitcher' },
  { id: 'svo', label: 'Save opportunities', short: 'SVO', group: 'pitcher' },
  { id: 'bs', label: 'Blown saves', short: 'BS', group: 'pitcher' },
  { id: 'hld', label: 'Holds', short: 'HLD', group: 'pitcher' },
  { id: 'p_k', label: 'Strikeouts (pitching)', short: 'K', group: 'pitcher' },
  { id: 'p_bb', label: 'Walks allowed', short: 'BB', group: 'pitcher' },
  { id: 'p_h', label: 'Hits allowed', short: 'H', group: 'pitcher' },
  { id: 'p_hr', label: 'Home runs allowed', short: 'HR', group: 'pitcher' },
  { id: 'p_hbp', label: 'Hit batters', short: 'HBP', group: 'pitcher' },
  { id: 'er', label: 'Earned runs', short: 'ER', group: 'pitcher' },
  { id: 'p_r', label: 'Runs allowed', short: 'R', group: 'pitcher' },
  { id: 'bf', label: 'Batters faced', short: 'BF', group: 'pitcher' },
  { id: 'pitches', label: 'Pitches', short: 'PIT', group: 'pitcher' },
  { id: 'cg', label: 'Complete games', short: 'CG', group: 'pitcher' },
  { id: 'sho', label: 'Shutouts', short: 'SHO', group: 'pitcher' },
  { id: 'qs', label: 'Quality starts', short: 'QS', group: 'pitcher', derived: true },
  { id: 'nh', label: 'No-hitters', short: 'NH', group: 'pitcher', derived: true },
];

export function deriveBaseball(line: StatLine): StatLine {
  const h = line.h ?? 0, d = line['2b'] ?? 0, t = line['3b'] ?? 0, hr = line.hr ?? 0;
  const singles = Math.max(0, h - d - t - hr);
  const outs = line.outs ?? 0;
  const started = (line.gs ?? 0) > 0;
  return {
    ...line,
    '1b': singles,
    tb: singles + 2 * d + 3 * t + 4 * hr,
    ip: Math.round((outs / 3) * 1000) / 1000,
    qs: started && outs >= 18 && (line.er ?? 0) <= 3 ? 1 : 0,
    nh: (line.cg ?? 0) > 0 && (line.p_h ?? 0) === 0 ? 1 : 0,
  };
}

export const MLB_CATEGORIES: CategoryDef[] = [
  { id: 'r', label: 'Runs', short: 'R', group: 'hitter', stat: 'r' },
  { id: 'hr', label: 'Home runs', short: 'HR', group: 'hitter', stat: 'hr' },
  { id: 'rbi', label: 'Runs batted in', short: 'RBI', group: 'hitter', stat: 'rbi' },
  { id: 'sb', label: 'Stolen bases', short: 'SB', group: 'hitter', stat: 'sb' },
  { id: 'avg', label: 'Batting average', short: 'AVG', group: 'hitter', ratio: { num: 'h', den: 'ab', decimals: 3 } },
  { id: 'obp', label: 'On-base %', short: 'OBP', group: 'hitter', ratio: { num: 'ob', den: 'obden', decimals: 3 } },
  { id: 'h', label: 'Hits', short: 'H', group: 'hitter', stat: 'h' },
  { id: 'tb', label: 'Total bases', short: 'TB', group: 'hitter', stat: 'tb' },
  { id: 'bb', label: 'Walks', short: 'BB', group: 'hitter', stat: 'bb' },
  { id: 'k', label: 'Strikeouts (hitting)', short: 'K', group: 'hitter', stat: 'k', lowerBetter: true },
  { id: 'w', label: 'Wins', short: 'W', group: 'pitcher', stat: 'w' },
  { id: 'sv', label: 'Saves', short: 'SV', group: 'pitcher', stat: 'sv' },
  { id: 'hld', label: 'Holds', short: 'HLD', group: 'pitcher', stat: 'hld' },
  { id: 'p_k', label: 'Strikeouts', short: 'K', group: 'pitcher', stat: 'p_k' },
  { id: 'era', label: 'Earned run average', short: 'ERA', group: 'pitcher', ratio: { num: 'er', den: 'outs', scale: 27, decimals: 2 }, lowerBetter: true },
  { id: 'whip', label: 'Walks + hits per inning', short: 'WHIP', group: 'pitcher', ratio: { num: 'whipnum', den: 'outs', scale: 3, decimals: 2 }, lowerBetter: true },
  { id: 'qs', label: 'Quality starts', short: 'QS', group: 'pitcher', stat: 'qs' },
  { id: 'ip', label: 'Innings pitched', short: 'IP', group: 'pitcher', stat: 'ip' },
  { id: 'k9', label: 'K per 9', short: 'K/9', group: 'pitcher', ratio: { num: 'p_k', den: 'outs', scale: 27, decimals: 2 } },
];

/** OBP and WHIP need sums no box score carries directly; the category engine
 *  asks the sport for them so a ratio's `num`/`den` are always plain keys. */
export function baseballCategoryInputs(totals: StatLine): StatLine {
  const bb = totals.bb ?? 0, hbp = totals.hbp ?? 0, h = totals.h ?? 0;
  return {
    ...totals,
    ob: h + bb + hbp,
    obden: (totals.ab ?? 0) + bb + hbp + (totals.sf ?? 0),
    whipnum: (totals.p_h ?? 0) + (totals.p_bb ?? 0),
  };
}

// statsapi position abbreviations. Outfielders collapse to OF; a two-way
// player (TWP) is a hitter AND a pitcher; 'P' alone is a pitcher whose role
// (SP/RP) is unknown until a starts ratio says otherwise — both for now.
const MLB_POS_MAP: Record<string, string[]> = {
  C: ['C'], '1B': ['1B'], '2B': ['2B'], '3B': ['3B'], SS: ['SS'],
  LF: ['OF'], CF: ['OF'], RF: ['OF'], OF: ['OF'], DH: ['DH'],
  SP: ['SP'], RP: ['RP'], P: ['SP', 'RP'], TWP: ['DH', 'SP', 'RP'],
};

const MLB_SLOTS: SportSlotType[] = [
  { type: 'C', label: 'C', pos: ['C'] },
  { type: '1B', label: '1B', pos: ['1B'] },
  { type: '2B', label: '2B', pos: ['2B'] },
  { type: '3B', label: '3B', pos: ['3B'] },
  { type: 'SS', label: 'SS', pos: ['SS'] },
  { type: 'OF', label: 'OF', pos: ['OF'] },
  { type: 'CI', label: 'CI (1B/3B)', pos: ['1B', '3B'] },
  { type: 'MI', label: 'MI (2B/SS)', pos: ['2B', 'SS'] },
  { type: 'UTIL', label: 'UTIL', pos: HITTERS },
  { type: 'SP', label: 'SP', pos: ['SP'] },
  { type: 'RP', label: 'RP', pos: ['RP'] },
  { type: 'P', label: 'P', pos: PITCHERS },
];

export const MLB: SportDef = {
  id: 'mlb',
  label: 'Baseball',
  league: 'MLB',
  period: 'daily',
  positions: MLB_POSITIONS,
  posMap: MLB_POS_MAP,
  groups: { hitter: HITTERS, pitcher: PITCHERS },
  slotTypes: MLB_SLOTS,
  // Yahoo's standard: C 1B 2B 3B SS OF×3 UTIL×2 · SP×2 RP×2 P×4, 5 BN, 4 IL.
  defaultRoster: { C: 1, '1B': 1, '2B': 1, '3B': 1, SS: 1, OF: 3, UTIL: 2, SP: 2, RP: 2, P: 4 },
  benchDefault: 5,
  irDefault: 4,
  stats: MLB_STATS,
  derive: deriveBaseball,
  scoringDefault: {
    '1b': 3, '2b': 5, '3b': 8, hr: 10, r: 2, rbi: 2, bb: 2, hbp: 2, sb: 5,
    outs: 0.75, p_k: 2, w: 4, er: -2, p_h: -0.6, p_bb: -0.6, p_hbp: -0.6, cg: 2.5, sho: 2.5, nh: 5, sv: 5, hld: 2,
  },
  categories: MLB_CATEGORIES,
  categoriesDefault: ['r', 'hr', 'rbi', 'sb', 'avg', 'w', 'sv', 'p_k', 'era', 'whip'],
  injuryStatuses: [
    { code: 'DTD', label: 'Day-to-day', out: false },
    { code: 'IL7', label: '7-day IL', out: true },
    { code: 'IL10', label: '10-day IL', out: true },
    { code: 'IL15', label: '15-day IL', out: true },
    { code: 'IL60', label: '60-day IL', out: true },
    { code: 'SUSP', label: 'Suspended', out: true },
    { code: 'O', label: 'Out', out: true },
  ],
  teams: 30,
  gamesPerTeam: 162,
  regularSeasonWeeks: 26,
  keyPrefix: 'mlb',
  vocab: { start: 'first pitch', starts: 'throws its first pitch', started: 'thrown its first pitch', slate: 'MLB SLATE', noGame: 'no game today' },
};
