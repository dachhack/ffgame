// A SPORT LEAGUE'S SHAPE (phase 3, v0.617.0) — the settings a native league
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

/** points: weekly totals head-to-head · cats: weekly categories head-to-head ·
 *  roto: no weekly result counts — the season is one ranking per category
 *  over every locked slot-day (sport_roto, computed by the worker). */
export type SportFormat = 'points' | 'cats' | 'roto';

export interface SportLeagueSettings {
  format: SportFormat;
  categories: string[];                 // for 'cats': the category ids compared
  scoring: Record<string, number>;      // overrides over the SportDef default table
  period_start: string;                 // YYYY-MM-DD, a Monday
  weeks: number;                        // regular-season periods
  bench: number;
  ir: number;
  /** REPLAY (v0.626.0): the league plays a past season on a shifted clock.
   *  `season` is the one replayed; `offset_days` is how far behind the real
   *  clock the league runs (real Monday of week 301 − period_start). The
   *  worker fetches that season's games for the league's virtual today and
   *  reveals each one when its start passes on the virtual clock, so locks,
   *  lines and finals progress day by day as they would live. */
  replay?: { season: string; offset_days: number } | null;
}

export interface SportSlotSpec { pos: string[]; label: string }

/** Whole days from `a` to `b` (YYYY-MM-DD each); negative when b is earlier. */
export const daysBetween = (a: string, b: string): number =>
  Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400e3);

/** The league's clock: the real one, or the replay's shifted one. */
export function sportNow(settings: Pick<SportLeagueSettings, 'replay'> | null | undefined, now: Date = new Date()): Date {
  const off = settings?.replay?.offset_days ?? 0;
  return off ? new Date(now.getTime() - off * 86400e3) : now;
}

/** The season before the one a sport is in now, as its starting year. */
export const priorSeason = (sport: Sport, now: Date = new Date()): string => String(Number(currentSeason(sport, now)) - 1);

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

/** The reverse of sportRosterSlots: how many of each slot type a stored
 *  spec holds, matching each spot's eligibility set to a slot type. A spot
 *  that matches no type (a commissioner's custom set) counts under its
 *  own joined key, so the builder can still show and keep it. */
export function slotCountsOf(def: SportDef, slots: { pos: string[] }[] | null | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of slots ?? []) {
    const set = [...new Set((s.pos ?? []).map((p) => String(p).toUpperCase()))].sort();
    const st = def.slotTypes.find((t) => t.pos.length === set.length && [...t.pos].sort().every((p, i) => p === set[i]));
    const key = st?.type ?? set.join('/');
    out[key] = (out[key] ?? 0) + 1;
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
export function sportLeagueSettings(sport: Sport, opts: { periodStart: string; weeks?: number; format?: SportFormat; categories?: string[]; roster?: Record<string, number>; scoring?: Record<string, number>;
  /** Replay a past season: its starting year, and the real date week 301 opens on (default today). */
  replay?: { season: string; anchor?: string } | null }) {
  const def = SPORTS[sport];
  const start = mondayOnOrBefore(opts.periodStart);
  const replay = opts.replay
    ? { season: opts.replay.season, offset_days: daysBetween(start, mondayOnOrBefore(opts.replay.anchor ?? new Date().toISOString().slice(0, 10))) }
    : null;
  const sportBlock: SportLeagueSettings = {
    format: opts.format ?? 'points',
    categories: opts.categories ?? def.categoriesDefault,
    scoring: opts.scoring ?? {},
    period_start: start,
    weeks: opts.weeks ?? def.regularSeasonWeeks,
    bench: def.benchDefault,
    ir: def.irDefault,
    ...(replay ? { replay } : {}),
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
    format: s.format === 'cats' ? 'cats' : s.format === 'roto' ? 'roto' : 'points',
    categories: Array.isArray(s.categories) ? s.categories.filter((c): c is string => typeof c === 'string') : [],
    scoring: s.scoring && typeof s.scoring === 'object' ? (s.scoring as Record<string, number>) : {},
    period_start: s.period_start,
    weeks: typeof s.weeks === 'number' ? s.weeks : 0,
    bench: typeof s.bench === 'number' ? s.bench : 0,
    ir: typeof s.ir === 'number' ? s.ir : 0,
    replay: s.replay && typeof s.replay === 'object' && typeof (s.replay as { season?: unknown }).season === 'string'
      ? { season: (s.replay as { season: string }).season, offset_days: Number((s.replay as { offset_days?: unknown }).offset_days ?? 0) || 0 }
      : null,
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
