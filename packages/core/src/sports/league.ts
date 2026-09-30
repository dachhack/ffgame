// A SPORT LEAGUE'S SHAPE (phase 3, v0.565.0) — the settings a native league
// in a daily sport carries, and the period calendar it plays on.
//
// THE CALENDAR. A daily sport still plays head-to-head by the week: period
// N is the Mon–Sun week starting `period_start + 7·(N−1)`. Board weeks for
// these leagues are numbered from SPORT_WEEK_BASE (301) so they can never
// collide with the NFL's 1–22, the preseason's 101+, or college's 201+ —
// the NFL worker selects matchups by bare week number, and a disjoint range
// is what keeps it from ever touching a sport league (docs/multi-sport-plan.md).
//
// THE LINEUP. `roster_slots` is the same SlotSpec array classic leagues use
// ({ pos: string[], label }), built from the SportDef's default lineup, so
// the classic board, the slot-cap trigger and the resolver read one shape.
// Positions are the sport's eligibility codes, not the NFL Pos union.
import type { Sport, SportDef, StatLine } from './types';
import { SPORTS } from './index';

export const SPORT_WEEK_BASE = 300;

export type SportFormat = 'points' | 'cats';

export interface SportLeagueSettings {
  format: SportFormat;
  categories: string[];                 // for 'cats': the category ids compared
  scoring: Record<string, number>;      // overrides over the SportDef default table
  period_start: string;                 // YYYY-MM-DD, a Monday
  weeks: number;                        // regular-season periods
  bench: number;
  ir: number;
}

export interface SportSlotSpec { pos: string[]; label: string }

/** The `roster_slots` array for a sport's standard lineup. */
export function sportRosterSlots(def: SportDef, roster: Record<string, number> = def.defaultRoster): SportSlotSpec[] {
  const out: SportSlotSpec[] = [];
  for (const [type, n] of Object.entries(roster)) {
    const st = def.slotTypes.find((s) => s.type === type);
    if (!st) continue;
    // Short labels (G1, UTIL2), as the NFL board's; the slot type's long
    // label is for pickers.
    for (let i = 0; i < n; i++) out.push({ pos: [...st.pos], label: n > 1 ? `${st.type}${i + 1}` : st.type });
  }
  return out;
}

/** Monday on or before a date (UTC calendar math on a YYYY-MM-DD). */
export function mondayOnOrBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = d.getUTCDay();                 // 0 Sun … 6 Sat
  d.setUTCDate(d.getUTCDate() - ((dow + 6) % 7));
  return d.toISOString().slice(0, 10);
}

export const addDays = (date: string, n: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** What create_native_league stores for a sport league: the lineup, and the
 *  sport block. `periodStart` defaults to the Monday of the given date. */
export function sportLeagueSettings(sport: Sport, opts: { periodStart: string; weeks?: number; format?: SportFormat; categories?: string[]; roster?: Record<string, number>; scoring?: Record<string, number> }) {
  const def = SPORTS[sport];
  const sportBlock: SportLeagueSettings = {
    format: opts.format ?? 'points',
    categories: opts.categories ?? def.categoriesDefault,
    scoring: opts.scoring ?? {},
    period_start: mondayOnOrBefore(opts.periodStart),
    weeks: opts.weeks ?? def.regularSeasonWeeks,
    bench: def.benchDefault,
    ir: def.irDefault,
  };
  return { roster_slots: sportRosterSlots(def, opts.roster), sport: sportBlock };
}

/** The dates a board week covers, or null for a non-sport week. */
export function sportPeriod(week: number, periodStart: string): { from: string; to: string } | null {
  if (week <= SPORT_WEEK_BASE) return null;
  const from = addDays(periodStart, 7 * (week - SPORT_WEEK_BASE - 1));
  return { from, to: addDays(from, 6) };
}

/** The board week a date falls in (301 for the first period), or null
 *  before the season starts. */
export function sportWeekOf(date: string, periodStart: string): number | null {
  const a = new Date(`${date}T00:00:00Z`).getTime(), b = new Date(`${periodStart}T00:00:00Z`).getTime();
  if (a < b) return null;
  return SPORT_WEEK_BASE + 1 + Math.floor((a - b) / (7 * 86400e3));
}

/** Read the sport block back off a league's settings_json, tolerating a
 *  league that predates it (null). */
export function sportSettingsOf(settings: Record<string, unknown> | null | undefined): SportLeagueSettings | null {
  const s = settings?.sport as Partial<SportLeagueSettings> | undefined;
  if (!s || typeof s !== 'object' || typeof s.period_start !== 'string') return null;
  return {
    format: s.format === 'cats' ? 'cats' : 'points',
    categories: Array.isArray(s.categories) ? s.categories.filter((c): c is string => typeof c === 'string') : [],
    scoring: s.scoring && typeof s.scoring === 'object' ? (s.scoring as Record<string, number>) : {},
    period_start: s.period_start,
    weeks: typeof s.weeks === 'number' ? s.weeks : 0,
    bench: typeof s.bench === 'number' ? s.bench : 0,
    ir: typeof s.ir === 'number' ? s.ir : 0,
  };
}

/** The season a sport is in on a date, as its starting year: NBA and NHL
 *  seasons straddle New Year (the 2026-27 season is '2026', from July on);
 *  MLB and WNBA seasons are the calendar year. The NFL keeps config.season. */
export function currentSeason(sport: Sport, now: Date = new Date()): string {
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  if (sport === 'nba' || sport === 'nhl') return String(m >= 7 ? y : y - 1);
  return String(y);
}

/** A locked slot-day with the line the player posted (or none). */
export interface LockedSlotLine { slot: string; date: string; playerKey: string; line: StatLine | null }
