// THE SPORT SPINE (v0.616.0) — what a sport IS to the platform.
//
// Founder: "What would it take for us to do hockey, NBA, MLB, WNBA fantasy …
// let's assume native leagues for all of these and no drip format."
//
// Everything a native classic league needs to know about a sport, stated as
// data in one object per sport (nfl.ts, nba.ts, wnba.ts, nhl.ts, mlb.ts): the
// eligibility codes a player may carry, the slot types a lineup is built from,
// the stat vocabulary a box score is normalised into, the points each stat is
// worth by default, and the categories a categories/roto league compares.
//
// WHY STAT LINES, NOT PLAYS. The NFL game scores play by play because Drip's
// effects fire on plays. A classic league only needs each player's line for
// each game — and every other league's official feed publishes exactly that,
// live, as a box score. So the unit of ingest for a non-NFL sport is the
// cumulative per-game STAT LINE (game_stat_line, migration 0424): idempotent
// to upsert, trivial to true up, no text parsing, no possession model.
//
// WHY ONE VOCABULARY PER SPORT. A feed's field names are the adapter's
// problem (server/src/sports/*.js); the engine only ever sees the short ids
// declared in `stats` below, so a scoring knob, a category and a UI label all
// name the same thing and a second feed for the same sport changes nothing
// above the adapter. Ratio stats (FG%, ERA…) are never stored — they are
// categories computed from their numerator and denominator at compare time,
// which is the only way a team's FG% comes out right.
//
// See docs/multi-sport-plan.md for the phases this is the first of.

export type Sport = 'nfl' | 'nba' | 'wnba' | 'nhl' | 'mlb';

export const SPORT_IDS: readonly Sport[] = ['nfl', 'nba', 'wnba', 'nhl', 'mlb'];

/** How a season is cut into scoring periods and when a lineup locks. NFL is
 *  weekly (one lock at the week's first kickoff, late swap per window); the
 *  daily sports play most days, so a period is still a Mon–Sun week for the
 *  matchup but each player locks at his own game's start. */
export type PeriodModel = 'weekly' | 'daily';

/** A player's cumulative line for one game (or a sum of them), keyed by the
 *  sport's short stat ids. Absent = 0. */
export type StatLine = Record<string, number>;

export interface StatDef {
  id: string;        // short id — the key in a StatLine and in a scoring table
  label: string;     // "Rebounds"
  short: string;     // "REB"
  /** Which players the stat applies to — a group name from SportDef.groups
   *  ('skater' | 'goalie' | 'hitter' | 'pitcher' | 'all'). Drives which knobs
   *  a settings UI shows together and which lines a category sums. */
  group: string;
  /** Computed by the sport's `derive` from other stats (double-double, quality
   *  start, innings pitched). Never expected from an adapter. */
  derived?: boolean;
}

export interface SportSlotType {
  type: string;      // 'PG' | 'G' | 'UTIL' | 'SP' …
  label: string;
  pos: string[];     // eligibility codes that may fill it
}

/** A category a categories/roto league compares. Either a plain stat total or
 *  a ratio of two totals; `lowerBetter` inverts the comparison (TO, ERA, GAA). */
export interface CategoryDef {
  id: string;
  label: string;
  short: string;
  group: string;
  stat?: string;
  ratio?: { num: string; den: string; scale?: number; decimals?: number };
  lowerBetter?: boolean;
}

export interface InjuryStatusDef {
  code: string;      // what the feed/admin writes
  label: string;
  /** Treated as "will not play" by lineup alarms and auto-slot. */
  out: boolean;
}

export interface SportDef {
  id: Sport;
  label: string;         // "Basketball"
  league: string;        // "NBA"
  period: PeriodModel;
  /** Every eligibility code a player may carry, in display order. */
  positions: string[];
  /** Feed position code → eligibility codes. A code missing here maps to
   *  itself when it is a known position, else to []. */
  posMap: Record<string, string[]>;
  /** Stat group → the positions it applies to. */
  groups: Record<string, string[]>;
  slotTypes: SportSlotType[];
  /** Starters per slot type — the platform's standard lineup. */
  defaultRoster: Record<string, number>;
  benchDefault: number;
  irDefault: number;
  stats: StatDef[];
  /** Fill derived stats from the raw line (pure; never mutates its input). */
  derive: (line: StatLine) => StatLine;
  /** Points per unit of each stat — the standard points-league scoring. */
  scoringDefault: Record<string, number>;
  categories: CategoryDef[];
  /** The ids of the sport's most common categories format (9-cat, 5x5…). */
  categoriesDefault: string[];
  injuryStatuses: InjuryStatusDef[];
  teams: number;
  gamesPerTeam: number;
  /** Regular-season Mon–Sun weeks a native schedule spans by default. */
  regularSeasonWeeks: number;
  /** The player_key prefix — `${prefix}-${feedId}`, numeric ids only, the same
   *  rule college uses (`c-<espn_id>`) so a key never collides with an NFL
   *  name slug. */
  keyPrefix: string;
  /** The words a board uses for this sport (v0.625.0): a game "kicks off" in
   *  the NFL, "tips off" in the NBA, and a lineup screen that says kickoff
   *  to a hockey league reads as somebody else's product. */
  vocab: SportVocab;
}

/** The sport's words for the moment a game starts and for its slate. Every
 *  string is lower-case prose except `slate`, which is a chip label. */
export interface SportVocab {
  /** the noun: "kickoff", "tip-off", "puck drop", "first pitch" */
  start: string;
  /** the verb, present: "kicks off", "tips off", "drops the puck", "throws its first pitch" */
  starts: string;
  /** the verb, past: "kicked off", "tipped off", "dropped the puck", "thrown its first pitch" */
  started: string;
  /** the chip label over the day's games: "NFL SLATE", "NBA SLATE" */
  slate: string;
  /** what a slot with nobody playing says: "no game this week" / "no game today" */
  noGame: string;
}
