import type { PlayerStats, Pos } from '../types';
import { QB_CSV, RB_CSV, WR_CSV, TE_CSV } from './statsRaw';

interface StatRow extends PlayerStats {
  name: string;
  pos: Pos;
  team: string;
}

function num(s: string): number {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Normalize a name for fuzzy matching: drop suffixes, punctuation, case. */
export function normName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z\s-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseCsv(csv: string, pos: Pos): StatRow[] {
  const lines = csv.trim().split('\n');
  const header = lines[0].split(',');
  const idx = (k: string) => header.indexOf(k);
  const out: StatRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(',');
    out.push({
      name: c[idx('player_display_name')],
      pos,
      team: c[idx('recent_team')],
      games: num(c[idx('games')]) || 1,
      passYds: idx('passing_yards') >= 0 ? num(c[idx('passing_yards')]) : 0,
      passTds: idx('passing_tds') >= 0 ? num(c[idx('passing_tds')]) : 0,
      ints: idx('interceptions') >= 0 ? num(c[idx('interceptions')]) : 0,
      carries: idx('carries') >= 0 ? num(c[idx('carries')]) : 0,
      rushYds: idx('rushing_yards') >= 0 ? num(c[idx('rushing_yards')]) : 0,
      rushTds: idx('rushing_tds') >= 0 ? num(c[idx('rushing_tds')]) : 0,
      targets: idx('targets') >= 0 ? num(c[idx('targets')]) : 0,
      receptions: idx('receptions') >= 0 ? num(c[idx('receptions')]) : 0,
      recYds: idx('receiving_yards') >= 0 ? num(c[idx('receiving_yards')]) : 0,
      recTds: idx('receiving_tds') >= 0 ? num(c[idx('receiving_tds')]) : 0,
      ppr: num(c[idx('fantasy_points_ppr')]),
    });
  }
  return out;
}

const ALL_ROWS: StatRow[] = [
  ...parseCsv(QB_CSV, 'QB'),
  ...parseCsv(RB_CSV, 'RB'),
  ...parseCsv(WR_CSV, 'WR'),
  ...parseCsv(TE_CSV, 'TE'),
];

const STAT_INDEX = new Map<string, StatRow>();
for (const r of ALL_ROWS) {
  const key = normName(r.name);
  if (!STAT_INDEX.has(key)) STAT_INDEX.set(key, r);
}

/** Lightweight descriptor for every player in the stats DB (waiver pool source). */
export interface StatPlayer { name: string; pos: Pos; team: string; ppr: number; }
export const STAT_PLAYERS: StatPlayer[] = ALL_ROWS.map((r) => ({ name: r.name, pos: r.pos, team: r.team, ppr: r.ppr }));

// Modest fallback season lines for players outside the pulled top tiers
// (deep-bench rookies, low-volume backups). Keeps the sim believable.
const DEFAULTS: Record<Pos, PlayerStats> = {
  QB: { games: 14, passYds: 2200, passTds: 12, ints: 8, carries: 30, rushYds: 120, rushTds: 2, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 150 },
  RB: { games: 14, carries: 70, rushYds: 290, rushTds: 2, targets: 18, receptions: 14, recYds: 100, recTds: 0, passYds: 0, passTds: 0, ints: 0, ppr: 55 },
  WR: { games: 14, targets: 45, receptions: 28, recYds: 320, recTds: 2, carries: 1, rushYds: 4, rushTds: 0, passYds: 0, passTds: 0, ints: 0, ppr: 60 },
  TE: { games: 14, targets: 32, receptions: 22, recYds: 210, recTds: 2, carries: 0, rushYds: 0, rushTds: 0, passYds: 0, passTds: 0, ints: 0, ppr: 48 },
  K: { games: 16, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 120 },
  DEF: { games: 16, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 110 },
  // IDP groups: no offensive box score; real scoring comes from defensive plays
  // (synthesized in Phase 1). A nominal ppr keeps default-lineup ranking sane.
  DL: { games: 16, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 90 },
  LB: { games: 16, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 100 },
  DB: { games: 16, passYds: 0, passTds: 0, ints: 0, carries: 0, rushYds: 0, rushTds: 0, targets: 0, receptions: 0, recYds: 0, recTds: 0, ppr: 90 },
};

export function statsForName(fullName: string, pos: Pos): PlayerStats {
  const row = STAT_INDEX.get(normName(fullName));
  if (row) {
    const { name: _n, pos: _p, team: _t, ...stats } = row;
    return stats;
  }
  return { ...DEFAULTS[pos] };
}

// Season stats keyed by engine slug (normName(name) with spaces → hyphens), the
// same id buildPlayer assigns. Lets the pre-game AI read a player's real season
// volume from just a slug (it has no full name on hand).
const SLUG_INDEX = new Map<string, StatRow>();
for (const r of ALL_ROWS) {
  const key = normName(r.name).replace(/\s+/g, '-');
  if (!SLUG_INDEX.has(key)) SLUG_INDEX.set(key, r);
}

/** Season totals for an engine slug, falling back to the position's baseline
 *  line when the slug isn't in the stats DB (deep bench / rookie). */
export function statsForSlug(slug: string, pos: Pos): PlayerStats {
  const row = SLUG_INDEX.get(slug);
  if (row) {
    const { name: _n, pos: _p, team: _t, ...stats } = row;
    return stats;
  }
  return { ...DEFAULTS[pos] };
}

/** Real recent NFL team for a player, from the stats DB ('' if unknown). */
export function teamForName(fullName: string): string {
  return STAT_INDEX.get(normName(fullName))?.team ?? '';
}

/** "Christian McCaffrey" -> "C. McCaffrey" */
export function shortName(full: string): string {
  const parts = full.split(' ');
  if (parts.length < 2) return full;
  const last = parts.slice(1).join(' ');
  return `${parts[0][0]}. ${last}`;
}

/** Deterministic 32-bit hash for seeding the per-week simulation. */
export function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
