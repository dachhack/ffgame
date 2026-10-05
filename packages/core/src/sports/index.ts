// The sport registry — one place to ask what a league's sport looks like.
import type { Sport, SportDef } from './types';
import { SPORT_IDS } from './types';
import { NFL } from './nfl';
import { NBA } from './nba';
import { WNBA } from './wnba';
import { NHL } from './nhl';
import { MLB } from './mlb';
import { EPL, MLS } from './soccer';

export type { Sport, SportDef, StatLine, StatDef, CategoryDef, SportSlotType, InjuryStatusDef, PeriodModel } from './types';
export { SPORT_IDS } from './types';
export { NFL, NBA, WNBA, NHL, MLB, EPL, MLS };

export const SPORTS: Record<Sport, SportDef> = { nfl: NFL, nba: NBA, wnba: WNBA, nhl: NHL, mlb: MLB, epl: EPL, mls: MLS };

export const isSport = (s: unknown): s is Sport => typeof s === 'string' && (SPORT_IDS as readonly string[]).includes(s);

/** The sport a league row / settings blob names; anything unknown is the NFL,
 *  because every league that existed before 0424 is. */
export function sportOf(src: { sport?: string | null } | string | null | undefined): Sport {
  const s = typeof src === 'string' ? src : src?.sport;
  return isSport(s) ? s : 'nfl';
}

export const sportDef = (s: Sport | string | null | undefined): SportDef => SPORTS[sportOf(s ?? null)];

/** Lineups lock per game (daily) rather than per week. */
export const isDailySport = (s: Sport | string | null | undefined): boolean => sportDef(s).period === 'daily';

/** Every eligibility code a feed position maps to for this sport. Unknown
 *  codes that happen to be positions map to themselves; the rest to []. */
export function eligibleFor(sport: Sport, feedPos: string | null | undefined): string[] {
  const def = SPORTS[sport];
  const code = (feedPos ?? '').trim().toUpperCase();
  if (!code) return [];
  const mapped = def.posMap[code];
  if (mapped) return [...mapped];
  return def.positions.includes(code) ? [code] : [];
}

/** May a player with these eligibilities fill this slot type? */
export function slotAccepts(sport: Sport, slotType: string, eligible: readonly string[]): boolean {
  const slot = SPORTS[sport].slotTypes.find((s) => s.type === slotType);
  if (!slot) return false;
  return eligible.some((p) => slot.pos.includes(p));
}

/** `${prefix}-${feedId}` — the storage key for a non-NFL player. Numeric feed
 *  ids only, mirroring college's `c-<espn_id>` rule. */
export function playerKey(sport: Sport, feedId: string | number): string {
  const id = String(feedId).trim();
  if (!/^\d+$/.test(id)) throw new Error(`${sport} player id must be numeric: ${feedId}`);
  return `${SPORTS[sport].keyPrefix}-${id}`;
}

const KEY_RE = /^(nba|wnba|nhl|mlb|epl|mls)-(\d+)$/;

/** The sport and feed id a player key names, or null for an NFL slug. */
export function parsePlayerKey(key: string | null | undefined): { sport: Sport; id: string } | null {
  const m = key ? KEY_RE.exec(key) : null;
  return m ? { sport: m[1] as Sport, id: m[2] } : null;
}

// ── Names, for boards that only hold a key (0426) ────────────────────────────
// A sport key is a feed id ('nba-1658'), so prettifying it prints "Nba 1658".
// The host installs the league's names (from league_pool / myPool rows) and a
// board asks here first, exactly as college's setCollegeNames works.
const SPORT_NAMES = new Map<string, { full: string; team: string | null }>();
export function setSportNames(rows: { slug: string; full?: string | null; full_name?: string | null; team?: string | null }[]): void {
  for (const r of rows) {
    const full = r.full ?? r.full_name;
    if (full && parsePlayerKey(r.slug)) SPORT_NAMES.set(r.slug, { full, team: r.team ?? SPORT_NAMES.get(r.slug)?.team ?? null });
  }
}
export const sportNameFor = (key: string | null | undefined): { full: string; team: string | null } | null =>
  (key ? SPORT_NAMES.get(key) ?? null : null);
