// WHAT A PLAYER CARD SHOWS FOR A SPORT PLAYER (v0.570.0): the handful of
// numbers a manager reads first, per sport, from a season line or a game
// line. Per-game averages come off the season line (gp) and ratios off the
// category definitions, so the card, the panel and the worker agree on
// what FG% or ERA means.
import type { SportDef, StatLine } from './types';
import { categoryValue, categoryById } from './score';

export interface CardStat { short: string; value: string }

/** Which stats a card leads with, by sport and by the player's population
 *  (hitter/pitcher, skater/goalie). Ratio ids are category ids. */
const CARD: Record<string, Record<string, string[]>> = {
  nba: { all: ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'tov', 'fgpct', 'ftpct', 'min'] },
  wnba: { all: ['pts', 'reb', 'ast', 'stl', 'blk', 'tpm', 'tov', 'fgpct', 'min'] },
  nhl: { skater: ['g', 'a', 'pts', 'sog', 'hit', 'blk', 'ppp', 'pim', 'toi'], goalie: ['w', 'l', 'otl', 'ga', 'sv', 'so', 'gaa', 'svpct'] },
  mlb: { hitter: ['ab', 'h', 'hr', 'r', 'rbi', 'sb', 'bb', 'k', 'avg', 'obp'], pitcher: ['ip', 'w', 'l', 'sv', 'hld', 'p_k', 'er', 'era', 'whip', 'qs'] },
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

const fmt = (n: number, decimals = 1) => (Number.isInteger(n) ? String(n) : n.toFixed(decimals));

/** Season totals as per-game numbers (counting stats ÷ GP, ratios as they
 *  are, minutes and innings per game). */
export function seasonCardStats(def: SportDef, line: StatLine | null | undefined, pos?: string | null): CardStat[] {
  if (!line) return [];
  const full = def.derive(line);
  const group = cardGroup(def, line, pos);
  const gp = Math.max(1, full.gp ?? full.hgp ?? full.pgp ?? full.gapp ?? 1);
  const out: CardStat[] = [];
  for (const id of CARD[def.id]?.[group] ?? []) {
    const cat = categoryById(def, id);
    if (cat?.ratio) { const v = categoryValue(cat, full); out.push({ short: cat.short, value: v == null ? '—' : v.toFixed(cat.ratio.decimals ?? 3) }); continue; }
    const st = def.stats.find((s) => s.id === id);
    if (!st) continue;
    const v = full[id] ?? 0;
    const perGame = ['w', 'l', 'otl', 'so', 'sv', 'hld', 'qs', 'cg', 'sho', 'gs'].includes(id) && def.id !== 'nba' && def.id !== 'wnba' ? v : v / gp;
    const total = ['w', 'l', 'otl', 'so', 'sv', 'hld', 'qs'].includes(id);
    out.push({ short: total ? st.short : `${st.short}/G`, value: fmt(total ? v : perGame, id === 'ip' || id === 'toi' || id === 'min' ? 1 : 1) });
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
