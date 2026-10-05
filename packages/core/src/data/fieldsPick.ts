// ▦ WHICH GAMES THE FIELDS WIDGET SHOWS (v0.631.0).
//
// Founder: "let's build a fields widget where the user can specify the games
// across multiple sports that display in the widget. The card should be an
// app widget."
//
// The home-screen fields widget listed the NFL (or college) week. Now it
// lists what the manager PICKS, across the sports the platform knows: which
// sports, and within a daily sport which teams to follow and which single
// games to show. Nothing picked within a sport means every game of it — the
// same "hide nothing" default the widget's league list uses, so a sport
// switched on shows something at once. Stored once for every fields widget
// on the home screen, in the app's own storage, which the headless task
// reads too (the same seam as widget:hidden).
//
// A soccer league (epl, mls) is in the spine but its games arrive with
// Stathead's delivery; the picker shows it greyed until a game exists.
import type { Sport } from '../sports/types';
import { SPORTS, isSport } from '../sports/index';
import { platform } from '../platform';
import type { SportGameRow } from './liveApi';

/** The sports a fields widget can list, in the order the picker shows them.
 *  The NFL covers college too (the widget's NFL/CFB chip). */
export const FIELDS_SPORTS: Sport[] = ['nfl', 'nba', 'nhl', 'mlb', 'wnba', 'epl', 'mls'];
/** Sports whose games are not served yet (no adapter until Stathead). */
export const FIELDS_PENDING: ReadonlySet<Sport> = new Set<Sport>(['epl', 'mls']);

export interface FieldsPick {
  /** The sports on the widget, in FIELDS_SPORTS order. */
  sports: Sport[];
  /** Per sport: team codes to follow. Empty = no team filter. */
  teams: Partial<Record<Sport, string[]>>;
  /** Per sport: single games to show (a daily sport's game_id; the NFL's
   *  `AWAY@HOME`). Empty = no game filter. */
  games: Partial<Record<Sport, string[]>>;
}

const KEY = 'widget:fields:pick';
export const DEFAULT_FIELDS_PICK: FieldsPick = { sports: ['nfl'], teams: {}, games: {} };

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.length > 0) : []);
const perSport = (v: unknown): Partial<Record<Sport, string[]>> => {
  const out: Partial<Record<Sport, string[]>> = {};
  if (v && typeof v === 'object') for (const [k, list] of Object.entries(v as Record<string, unknown>)) if (isSport(k) && strs(list).length) out[k] = strs(list);
  return out;
};

/** The stored pick, or the default (the NFL alone, as before). */
export function fieldsPick(): FieldsPick {
  try {
    const raw = platform().storage.get(KEY);
    if (!raw) return { ...DEFAULT_FIELDS_PICK, teams: {}, games: {} };
    const v = JSON.parse(raw) as Partial<FieldsPick>;
    const sports = FIELDS_SPORTS.filter((s) => strs(v.sports).includes(s));
    return { sports: sports.length ? sports : ['nfl'], teams: perSport(v.teams), games: perSport(v.games) };
  } catch { return { ...DEFAULT_FIELDS_PICK, teams: {}, games: {} }; }
}
export function setFieldsPick(p: FieldsPick): void {
  try { platform().storage.set(KEY, JSON.stringify({ sports: FIELDS_SPORTS.filter((s) => p.sports.includes(s)), teams: p.teams, games: p.games })); } catch { /* best-effort */ }
}

/** Does a game pass the pick for its sport? Games picked → only those; else
 *  teams followed → games with one of them; else every game. */
export function fieldsPickAllows(p: FieldsPick, sport: Sport, g: { key: string; away: string; home: string }): boolean {
  const games = p.games[sport] ?? [];
  if (games.length) return games.includes(g.key);
  const teams = (p.teams[sport] ?? []).map((t) => t.toUpperCase());
  if (teams.length) return teams.includes(g.away.toUpperCase()) || teams.includes(g.home.toUpperCase());
  return true;
}

/** One daily-sport game as the widget lists it. */
export interface SportFieldGame {
  key: string;            // `${sport}:${game_id}`
  sport: Sport;
  gameId: string;
  away: string;
  home: string;
  as: number;
  hs: number;
  state: 'pre' | 'live' | 'final';
  /** The feed's clock while live ("Q3 2:35", "T7"), FINAL when done, null before. */
  clock: string | null;
  startMs: number | null;
  gameDate: string;
}

/** A sport's rows over a few days → the games to list, live first, then to
 *  come in start order, then finals; postponements and cancellations are
 *  left off; yesterday's games only while still live. */
export function sportFieldGames(sport: Sport, rows: SportGameRow[], pick: FieldsPick, today: string): SportFieldGame[] {
  const rank = { live: 0, pre: 1, final: 2 } as const;
  return rows
    .filter((r) => r.status === 'pre' || r.status === 'live' || r.status === 'final')
    .filter((r) => r.game_date >= today || r.status === 'live')
    .map((r): SportFieldGame => ({
      key: `${sport}:${r.game_id}`, sport, gameId: r.game_id, away: r.away, home: r.home,
      as: r.away_score ?? 0, hs: r.home_score ?? 0,
      state: r.status as 'pre' | 'live' | 'final',
      clock: r.status === 'final' ? 'FINAL' : r.status === 'live' ? r.clock || 'LIVE' : null,
      startMs: r.start_utc ? Date.parse(r.start_utc) : null, gameDate: r.game_date,
    }))
    .filter((g) => fieldsPickAllows(pick, sport, { key: g.gameId, away: g.away, home: g.home }))
    .sort((a, b) => rank[a.state] - rank[b.state] || (a.startMs ?? Infinity) - (b.startMs ?? Infinity) || a.gameId.localeCompare(b.gameId));
}

/** The team codes a picker offers for a sport: everyone on the slate it read. */
export const sportTeamsOf = (rows: SportGameRow[]): string[] => [...new Set(rows.flatMap((r) => [r.away, r.home]))].sort();

export const fieldsSportLabel = (s: Sport): string => SPORTS[s].league;
