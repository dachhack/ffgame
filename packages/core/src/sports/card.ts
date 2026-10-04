// WHAT A PLAYER CARD SHOWS FOR A SPORT PLAYER (v0.622.0): the handful of
// numbers a manager reads first, per sport, from a season line or a game
// line. Per-game averages come off the season line (gp) and ratios off the
// category definitions, so the card, the panel and the worker agree on
// what FG% or ERA means.
//
// A SEASON LINE IS A SUM. The per-game derived stats — a double-double, a
// quality start, a no-hitter — cannot be re-derived from season totals
// (the season is not one big game), so a season line carries them as
// COUNTS where its source has them (Sleeper's NBA stats do) and the card
// reads those; the additive derived stats (points, PPP, IP, singles) are
// derived as usual. `seasonLine` is that correction, and the points a
// season is worth run through it too.
import type { SportDef, StatLine } from './types';
import { categoryValue, categoryById, categoryTotals, linePoints } from './score';

export interface CardStat { short: string; value: string }

/** Derived stats that only mean something per game. */
export const PER_GAME_DERIVED = ['dd', 'td', 'qs', 'nh'];

/** A season line with its per-game derived stats taken from the stored
 *  counts (0 when the source has none) rather than re-derived. */
export function seasonLine(def: SportDef, line: StatLine): StatLine {
  const full = def.derive(line);
  for (const k of PER_GAME_DERIVED) if (k in full) full[k] = line[k] ?? 0;
  return full;
}

/** Fantasy points a season line is worth under a table, per-game derived
 *  stats counted as stored. */
export function seasonPoints(def: SportDef, line: StatLine, scoring?: Record<string, number> | null): number {
  const sc = scoring ?? def.scoringDefault;
  const full = seasonLine(def, line);
  let pts = 0;
  for (const k in sc) if (full[k]) pts += sc[k] * full[k];
  return Math.round(pts * 100) / 100;
}

/** Which stats a card leads with, by sport and by the player's population
 *  (hitter/pitcher, skater/goalie). Ratio ids are category ids. */
const CARD: Record<string, Record<string, string[]>> = {
  nba: { all: ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'tov', 'fgpct', 'ftpct', 'min'] },
  wnba: { all: ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'tov', 'fgpct', 'min'] },
  nhl: { skater: ['g', 'a', 'pts', 'sog', 'hit', 'blk', 'ppp', 'pim', 'toi'], goalie: ['w', 'l', 'otl', 'ga', 'sv', 'so', 'gaa', 'svpct'] },
  mlb: { hitter: ['ab', 'h', 'hr', 'r', 'rbi', 'sb', 'bb', 'k', 'avg', 'obp'], pitcher: ['ip', 'w', 'l', 'sv', 'hld', 'p_k', 'er', 'era', 'whip', 'qs'] },
};

/** Stats a season card shows as TOTALS rather than per game, per sport:
 *  decisions and shutouts are counted, not averaged. */
const SEASON_TOTALS: Record<string, string[]> = {
  nhl: ['w', 'l', 'otl', 'so'],
  mlb: ['w', 'l', 'sv', 'hld', 'qs', 'cg', 'sho', 'nh'],
};

/** The population a line belongs to: the group whose stats it carries. */
export function cardGroup(def: SportDef, line: StatLine | null | undefined, pos?: string | null): string {
  const groups = Object.keys(def.groups);
  if (groups.length === 1) return groups[0];
  if (pos) { const g = groups.find((k) => def.groups[k].includes(pos)); if (g) return g; }
  if (line) {
    // A two-way player shows as what he did more of.
    const score = (g: string) => def.stats.filter((s) => s.group === g && !s.derived).reduce((t, s) => t + Math.abs(line[s.id] ?? 0), 0);
    return groups.sort((a, b) => score(b) - score(a))[0];
  }
  return groups[0];
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Season totals as per-game numbers (counting stats ÷ GP, decisions as
 *  totals, ratios from the category definitions with the sport's inputs). */
export function seasonCardStats(def: SportDef, line: StatLine | null | undefined, pos?: string | null): CardStat[] {
  if (!line) return [];
  const full = seasonLine(def, line);
  // Ratios need the sport's inputs (OBP's on-base parts, WHIP's numerator);
  // categoryTotals adds them for one line as for a team's.
  const totals = categoryTotals(def, [full]);
  const group = cardGroup(def, line, pos);
  const gp = Math.max(1, full.gp ?? full.hgp ?? full.pgp ?? full.gapp ?? 1);
  const isTotal = new Set(SEASON_TOTALS[def.id] ?? []);
  const out: CardStat[] = [];
  for (const id of CARD[def.id]?.[group] ?? []) {
    const cat = categoryById(def, id);
    if (cat?.ratio) { const v = categoryValue(cat, totals); out.push({ short: cat.short, value: v == null ? '—' : v.toFixed(cat.ratio.decimals ?? 3) }); continue; }
    const st = def.stats.find((s) => s.id === id);
    if (!st) continue;
    // A per-game derived stat the source never counted is unknown, not 0.
    if (PER_GAME_DERIVED.includes(id) && !(id in line)) { out.push({ short: st.short, value: '—' }); continue; }
    const v = full[id] ?? 0;
    if (isTotal.has(id)) out.push({ short: st.short, value: fmt(v) });
    else out.push({ short: `${st.short}/G`, value: fmt(v / gp) });
  }
  return out;
}

/** One game's line, as the card's stat chips. */
export function gameCardStats(def: SportDef, line: StatLine | null | undefined, pos?: string | null): CardStat[] {
  if (!line) return [];
  const full = def.derive(line);
  const group = cardGroup(def, line, pos);
  const out: CardStat[] = [];
  for (const id of CARD[def.id]?.[group] ?? []) {
    const cat = categoryById(def, id);
    if (cat?.ratio) continue;               // a single game's ratios are noise
    const st = def.stats.find((s) => s.id === id);
    if (!st || id === 'min' || id === 'toi') continue;
    const v = full[id] ?? 0;
    if (!v) continue;
    out.push({ short: st.short, value: fmt(v) });
  }
  return out;
}

/** Points one game's line is worth — the ordinary per-game rule. */
export const gamePoints = (def: SportDef, line: StatLine, scoring?: Record<string, number> | null): number => linePoints(def, line, scoring);
