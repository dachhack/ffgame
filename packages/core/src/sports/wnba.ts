// WNBA — basketball's stat vocabulary with the league's own lineup shape.
//
// The only season-long WNBA fantasy game on a major platform is ESPN's, so
// its defaults are the standard here: 2 G, 3 F/C, 1 UTIL, 3 BN, 1 IR, and
// points PTS 1, REB 1, AST 1, STL 2, BLK 2, 3PM 1. Feeds (cdn.wnba.com, ESPN)
// carry three eligibility codes, G / F / C, sometimes hyphenated.
import type { SportDef, SportSlotType } from './types';
import { BASKETBALL_STATS, BASKETBALL_CATEGORIES, NINE_CAT, NBA_INJURY_STATUSES, deriveBasketball } from './nba';

const WNBA_POSITIONS = ['G', 'F', 'C'];

const WNBA_POS_MAP: Record<string, string[]> = {
  G: ['G'], F: ['F'], C: ['C'],
  'G-F': ['G', 'F'], 'F-G': ['F', 'G'], 'F-C': ['F', 'C'], 'C-F': ['C', 'F'],
  PG: ['G'], SG: ['G'], SF: ['F'], PF: ['F'],
};

const WNBA_SLOTS: SportSlotType[] = [
  { type: 'G', label: 'G', pos: ['G'] },
  { type: 'F', label: 'F', pos: ['F'] },
  { type: 'C', label: 'C', pos: ['C'] },
  { type: 'FC', label: 'F/C', pos: ['F', 'C'] },
  { type: 'UTIL', label: 'UTIL', pos: WNBA_POSITIONS },
];

export const WNBA: SportDef = {
  id: 'wnba',
  label: 'Basketball',
  league: 'WNBA',
  period: 'daily',
  positions: WNBA_POSITIONS,
  posMap: WNBA_POS_MAP,
  groups: { all: WNBA_POSITIONS },
  slotTypes: WNBA_SLOTS,
  defaultRoster: { G: 2, FC: 3, UTIL: 1 },
  benchDefault: 3,
  irDefault: 1,
  stats: BASKETBALL_STATS,
  derive: deriveBasketball,
  scoringDefault: { pts: 1, reb: 1, ast: 1, stl: 2, blk: 2, tpm: 1 },
  categories: BASKETBALL_CATEGORIES,
  categoriesDefault: NINE_CAT,
  injuryStatuses: NBA_INJURY_STATUSES,
  teams: 15,
  gamesPerTeam: 44,
  regularSeasonWeeks: 20,
  keyPrefix: 'wnba',
  vocab: { start: 'tip-off', starts: 'tips off', started: 'tipped off', slate: 'WNBA SLATE', noGame: 'no game today' },
};
