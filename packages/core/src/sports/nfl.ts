// FOOTBALL — the NFL as a SportDef, so the registry is complete.
//
// The NFL does not score through this module: its live game is play-by-play
// (engine/sim.ts, engine/classic.ts) and its classic scoring is the
// ~150-knob ClassicScoring table, both untouched. What the platform reads
// from here is the shape — positions, slot types, the weekly period model —
// so a screen or an RPC that asks "what does this league's sport look like"
// gets one answer for every sport. Its `stats` are the season-line keys the
// existing PlayerStats type already carries, for label lookups only.
import type { SportDef, StatLine } from './types';
import { CLASSIC_SLOT_TYPES, DEFAULT_CLASSIC_ROSTER } from '../engine/classic';

const NFL_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P', 'RET'];

export const NFL: SportDef = {
  id: 'nfl',
  label: 'Football',
  league: 'NFL',
  period: 'weekly',
  positions: NFL_POSITIONS,
  posMap: Object.fromEntries(NFL_POSITIONS.map((p) => [p, [p]])),
  groups: { offense: ['QB', 'RB', 'WR', 'TE', 'FB', 'RET'], kicking: ['K', 'P'], defense: ['DEF', 'DL', 'LB', 'DB'], coach: ['HC'] },
  slotTypes: CLASSIC_SLOT_TYPES.map((s) => ({ type: s.type, label: s.label, pos: [...s.pos] })),
  defaultRoster: { ...DEFAULT_CLASSIC_ROSTER },
  benchDefault: 6,
  irDefault: 2,
  stats: [
    { id: 'passYds', label: 'Passing yards', short: 'PASS YD', group: 'offense' },
    { id: 'passTds', label: 'Passing TDs', short: 'PASS TD', group: 'offense' },
    { id: 'ints', label: 'Interceptions', short: 'INT', group: 'offense' },
    { id: 'carries', label: 'Carries', short: 'CAR', group: 'offense' },
    { id: 'rushYds', label: 'Rushing yards', short: 'RUSH YD', group: 'offense' },
    { id: 'rushTds', label: 'Rushing TDs', short: 'RUSH TD', group: 'offense' },
    { id: 'targets', label: 'Targets', short: 'TGT', group: 'offense' },
    { id: 'receptions', label: 'Receptions', short: 'REC', group: 'offense' },
    { id: 'recYds', label: 'Receiving yards', short: 'REC YD', group: 'offense' },
    { id: 'recTds', label: 'Receiving TDs', short: 'REC TD', group: 'offense' },
  ],
  derive: (line: StatLine) => ({ ...line }),
  // Not the NFL's scoring: see engine/classic.ts. Empty so a generic scorer
  // handed an NFL line scores nothing rather than something made up.
  scoringDefault: {},
  categories: [],
  categoriesDefault: [],
  injuryStatuses: [
    { code: 'O', label: 'Out', out: true },
    { code: 'D', label: 'Doubtful', out: false },
    { code: 'Q', label: 'Questionable', out: false },
    { code: 'IR', label: 'Injured reserve', out: true },
  ],
  teams: 32,
  gamesPerTeam: 17,
  regularSeasonWeeks: 14,
  keyPrefix: 'nfl',
  vocab: { start: 'kickoff', starts: 'kicks off', started: 'kicked off', slate: 'NFL SLATE', noGame: 'no game this week' },
};
