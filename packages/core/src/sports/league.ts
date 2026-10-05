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
 *  over every locked slot-day (sport_roto, computed by the worker) ·
 *  season (v0.629.0): no weekly result counts — the season is one total of
 *  points over every locked slot-day (the same table, points only). */
export type SportFormat = 'points' | 'cats' | 'roto' | 'season';
export const SPORT_FORMATS: SportFormat[] = ['points', 'cats', 'roto', 'season'];
export const SPORT_FORMAT_LABEL: Record<SportFormat, string> = { points: 'POINTS', cats: 'H2H CATEGORIES', roto: 'ROTO', season: 'SEASON POINTS' };
/** A format with no weekly winner: the standings are the season table. */
export const isSeasonFormat = (f: SportFormat | null | undefined): boolean => f === 'roto' || f === 'season';

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

/** One starting spot (0431), with what a football spot may carry (0436):
 *  `bb` best ball — fills itself nightly with the roster's top eligible
 *  scorer; `teams` only players on these teams; `min_exp`/`max_exp` tenure
 *  in seasons (max_exp 0 = rookies only). The keys are the NFL SlotSpec's,
 *  so classicSlotsFromSpec, slotAllows and leagueBestball read a sport spot
 *  unchanged. */
export interface SportSlotSpec { pos: string[]; label: string; bb?: boolean; teams?: string[]; min_exp?: number | null; max_exp?: number | null }

/** Which sports carry a tenure (years of experience) in their directory:
 *  NBA from Sleeper's years_exp, MLB from the debut date, NHL from the stats
 *  bios' first season (v0.629.1). The WNBA feed has none, so a tenure-scoped
 *  spot there would refuse everyone; soccer joins when Stathead's directory
 *  carries it. */
export const sportHasTenure = (sport: Sport): boolean => sport === 'nba' || sport === 'mlb' || sport === 'nhl';

/** The spot's scope on screen: "BOS/LAL · ROOKIES ONLY", or ''. */
export function sportSpotScopeLabel(s: Pick<SportSlotSpec, 'teams' | 'min_exp' | 'max_exp'> | null | undefined): string {
  if (!s) return '';
  const parts: string[] = [];
  if (s.teams?.length) parts.push(s.teams.join('/'));
  if (s.min_exp != null || s.max_exp != null) {
    parts.push(s.max_exp === 0 ? 'ROOKIES ONLY' : s.min_exp != null && s.max_exp == null ? `${s.min_exp}+ YRS` : `${s.min_exp ?? 0}–${s.max_exp} YRS`);
  }
  return parts.join(' · ');
}

/** The slot type a spot's eligibility set matches, or null for a custom set. */
export function sportSlotTypeOf(def: SportDef, pos: string[] | null | undefined): SportDef['slotTypes'][number] | null {
  const set = [...new Set((pos ?? []).map((p) => String(p).toUpperCase()))].sort();
  return def.slotTypes.find((t) => t.pos.length === set.length && [...t.pos].sort().every((p, i) => p === set[i])) ?? null;
}

/** Re-label a spot list the way sportRosterSlots labels a fresh one (G, or
 *  G1 G2 when a type repeats; a custom set keeps its joined codes), keeping
 *  every spot's flags. The builder calls this after adding or removing a
 *  spot so the names stay in step. */
export function sportRelabelSlots(def: SportDef, spots: SportSlotSpec[]): SportSlotSpec[] {
  const keyOf = (s: SportSlotSpec) => sportSlotTypeOf(def, s.pos)?.type ?? [...new Set(s.pos.map((p) => p.toUpperCase()))].sort().join('/');
  const total = new Map<string, number>();
  for (const s of spots) { const k = keyOf(s); total.set(k, (total.get(k) ?? 0) + 1); }
  const seen = new Map<string, number>();
  return spots.map((s) => {
    const k = keyOf(s);
    const i = (seen.get(k) ?? 0) + 1;
    seen.set(k, i);
    return { ...s, pos: [...s.pos], label: (total.get(k) ?? 1) > 1 ? `${k}${i}` : k };
  });
}

/** Add one spot of a slot type at the end of its group (or the end). */
export function sportAddSlot(def: SportDef, spots: SportSlotSpec[], type: string): SportSlotSpec[] {
  const st = def.slotTypes.find((t) => t.type === type);
  const pos = st ? [...st.pos] : type.split('/');
  const keyOf = (s: SportSlotSpec) => sportSlotTypeOf(def, s.pos)?.type ?? [...new Set(s.pos.map((p) => p.toUpperCase()))].sort().join('/');
  let at = -1;
  spots.forEach((s, i) => { if (keyOf(s) === type) at = i; });
  const next = [...spots];
  next.splice(at < 0 ? next.length : at + 1, 0, { pos, label: type });
  return sportRelabelSlots(def, next);
}

/** Remove the last spot of a slot type. */
export function sportRemoveSlot(def: SportDef, spots: SportSlotSpec[], type: string): SportSlotSpec[] {
  const keyOf = (s: SportSlotSpec) => sportSlotTypeOf(def, s.pos)?.type ?? [...new Set(s.pos.map((p) => p.toUpperCase()))].sort().join('/');
  let at = -1;
  spots.forEach((s, i) => { if (keyOf(s) === type) at = i; });
  if (at < 0) return spots;
  const next = [...spots];
  next.splice(at, 1);
  return sportRelabelSlots(def, next);
}

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
    const key = sportSlotTypeOf(def, set)?.type ?? set.join('/');
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

/** The last day on or before `date` that falls on ISO weekday `dow` (1
 *  Monday … 7 Sunday); UTC calendar math on a YYYY-MM-DD. */
export function weekStartOnOrBefore(date: string, dow = 1): string {
  const d = new Date(`${date}T00:00:00Z`);
  const iso = ((d.getUTCDay() + 6) % 7) + 1;  // 1 Mon … 7 Sun
  d.setUTCDate(d.getUTCDate() - ((iso - dow + 7) % 7));
  return d.toISOString().slice(0, 10);
}

/** Monday on or before a date. */
export const mondayOnOrBefore = (date: string): string => weekStartOnOrBefore(date, 1);

/** The ISO weekday a sport's periods open on: Monday for every sport but
 *  soccer, whose matchweeks run Saturday to Monday night (v0.630.0). */
export const sportWeekStartDow = (sport: Sport): number => SPORTS[sport].weekStartDow ?? 1;
export const SPORT_WEEK_START_LABEL: Record<number, string> = { 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT', 7: 'SUN' };

/** The period start on or before a date, on the sport's own weekday. */
export const periodStartOnOrBefore = (sport: Sport, date: string): string => weekStartOnOrBefore(date, sportWeekStartDow(sport));

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
  const start = periodStartOnOrBefore(sport, opts.periodStart);
  const replay = opts.replay
    ? { season: opts.replay.season, offset_days: daysBetween(start, periodStartOnOrBefore(sport, opts.replay.anchor ?? new Date().toISOString().slice(0, 10))) }
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
    format: s.format === 'cats' ? 'cats' : s.format === 'roto' ? 'roto' : s.format === 'season' ? 'season' : 'points',
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

/** The season a sport is in on a date, as its starting year: NBA, NHL and
 *  Premier League seasons straddle New Year (the 2026-27 season is '2026',
 *  from July on); MLB, WNBA and MLS seasons are the calendar year. The NFL
 *  keeps config.season. */
export function currentSeason(sport: Sport, now: Date = new Date()): string {
  const y = now.getUTCFullYear(), m = now.getUTCMonth() + 1;
  if (sport === 'nba' || sport === 'nhl' || sport === 'epl') return String(m >= 7 ? y : y - 1);
  return String(y);
}

/** A locked slot-day with the line the player posted (or none). */
export interface LockedSlotLine { slot: string; date: string; playerKey: string; line: StatLine | null }
