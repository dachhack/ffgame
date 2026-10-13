// ONE SPELLING PER NFL TEAM (v0.707.0). Founder: "Can we make sure that matching
// error never happens again at any place in the app or web?"
//
// The feeds disagree on four clubs: Sleeper says LAR / WSH / JAC, ESPN (our
// slate, nfl_slate) says LA / WAS / JAX, and old tapes say OAK / SD / STL / AZ.
// Every "a Rams player is missing / frozen / unlockable" bug this project has
// had (#1028, #1095, the Oct 2 Kickoff chat, Mooney's "Stafford is not a QB
// option in Bullseye") was one more place that compared a team code RAW, next
// to a place that normalised. There is no safe way to remember to normalise at
// every lookup, so this module makes it impossible to forget:
//
//   • `normTeam`  — the table. The SQL `_nfl_team` and scoreboard.js TEAM_FIX
//                   mirror it, and scripts/check-team-codes.mjs holds them to it.
//   • `TeamMap`   — a Map whose keys are normalised on set AND get, so a slate
//                   keyed by LA answers a lookup by LAR. Use it for anything
//                   keyed by team: kickoffs, locks, slate spots, depth charts.
//   • `TeamSet`   — the same for a Set of teams (the week's slate teams).
//   • `sameTeam`  — `a === b` for two codes.
//
// scripts/check-team-codes.mjs (check:parity) fails the build on a raw
// `x.has(p.team)` / `x.get(p.team)` / `p.team === q.team` anywhere in the
// worker, the web app or the phone app, unless the line normalises or wears a
// `team-code:` waiver saying why both sides come from the same source.

/** Provider / relocation codes → the slate's codes. Unknown codes pass through
 *  upper-cased; an empty or null code is ''. */
export function normTeam(t: string | null | undefined): string {
  const u = String(t ?? '').trim().toUpperCase();
  return u === 'LAR' ? 'LA' : u === 'WSH' ? 'WAS' : u === 'JAC' ? 'JAX' : u === 'OAK' ? 'LV' : u === 'LVR' ? 'LV' : u === 'SD' ? 'LAC' : u === 'STL' ? 'LA' : u === 'AZ' ? 'ARI' : u;
}

/** The aliases the table folds, for tests and the check: [alias, canonical]. */
export const TEAM_ALIASES: readonly (readonly [string, string])[] = [
  ['LAR', 'LA'], ['STL', 'LA'], ['WSH', 'WAS'], ['JAC', 'JAX'], ['OAK', 'LV'], ['LVR', 'LV'], ['SD', 'LAC'], ['AZ', 'ARI'],
];

/** Two team codes, however each feed spells them. */
export function sameTeam(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normTeam(a);
  return x !== '' && x === normTeam(b);
}

/** A Map keyed by NFL team: every key is normalised going in and coming out,
 *  so `m.set('LA', …); m.get('LAR')` finds it. Iteration yields the slate's codes. */
export class TeamMap<V> extends Map<string, V> {
  constructor(entries?: Iterable<readonly [string, V]> | null) {
    super();
    if (entries) for (const [k, v] of entries) this.set(k, v);
  }
  override get(key: string | null | undefined): V | undefined { return super.get(normTeam(key)); }
  override has(key: string | null | undefined): boolean { return super.has(normTeam(key)); }
  override set(key: string | null | undefined, value: V): this { return super.set(normTeam(key), value); }
  override delete(key: string | null | undefined): boolean { return super.delete(normTeam(key)); }
}

/** A Set of NFL teams with the same promise. */
export class TeamSet extends Set<string> {
  constructor(values?: Iterable<string | null | undefined> | null) {
    super();
    if (values) for (const v of values) this.add(v);
  }
  override has(value: string | null | undefined): boolean { return super.has(normTeam(value)); }
  override add(value: string | null | undefined): this { const t = normTeam(value); if (t) super.add(t); return this; }
  override delete(value: string | null | undefined): boolean { return super.delete(normTeam(value)); }
}
