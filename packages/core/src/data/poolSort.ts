// HOW A LIST OF AVAILABLE PLAYERS IS ORDERED (v0.302.0, founder: "we also need
// sort by ADP and projected points in waivers and draftable players. Sort by
// ownership % would be good too").
//
// Every list of available players in this project — the waiver wire, the free
// agent pool, the draft room's board — has always been ordered by RANK, the
// number the pool was seeded with. Rank answers "who is best" in the abstract;
// it does not answer "who is going early", "who scores most this year", or
// "who has everyone else already taken", and those are three different
// questions a manager asks at three different moments.
//
// The four orders, and what each is FOR:
//
//   • RANK — the pool's own order. The default, and the one the draft board's
//     autopick follows, so a room that sorts by anything else still sees the
//     order the clock will take if it runs out.
//   • ADP  — consensus average draft position (adp2026). Ascending: earlier is
//     first. "Who is going before my next pick."
//   • PROJ — projected points per game, UNDER THIS LEAGUE'S RULES as of
//     v0.310.0 (see below). Descending. "Who scores the most", which ADP only
//     approximates.
//   • OWN  — the share of this platform's drafted leagues rostering him
//     (player_ownership, 0199). Descending. "Who does everybody else have."
//
// A player the source doesn't know sorts LAST in every order rather than
// first — an unknown ADP is not an ADP of zero, and a missing projection is
// not a projection of zero. The pool's rank breaks every tie, so two players
// the source can't separate stay in the order the league already agreed on.

import { adpValue } from './adp2026';
import { dynFor, setDynFormat } from './dyn2026';
import { projectedPoints, hasProjection } from '../engine/projScoring';
import { slugSleeperId } from './slugMeta';

/** Every position a draft room can filter by (v0.554.0): the chips are then
 *  trimmed to the league's own (leagueEligiblePos + zero caps), so IDP, FB,
 *  HC and P appear exactly where the league plays them. One list for both
 *  hosts — the app's used to stop at DEF. */
export const DRAFT_POS_FILTERS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'DL', 'LB', 'DB', 'FB', 'HC', 'P'] as const;

/** NFL / college, for a pool that holds both (devy and mixed leagues). */
export type LevelFilter = 'all' | 'nfl' | 'cfb';
export const LEVEL_FILTERS: { id: LevelFilter; label: string }[] = [
  { id: 'all', label: 'ALL' }, { id: 'nfl', label: 'NFL' }, { id: 'cfb', label: 'CFB' },
];
/** College class chips — ESPN's experience years; 4 covers seniors and beyond. */
export const CLASS_FILTERS: { id: number; label: string }[] = [
  { id: 1, label: 'FR' }, { id: 2, label: 'SO' }, { id: 3, label: 'JR' }, { id: 4, label: 'SR+' },
];
/** Does a pool row pass the level and class filters? A class choice means
 *  college: an NFL player never matches one. */
export function levelClassMatch(p: { slug: string; cls?: number | null }, level: LevelFilter, cls: ReadonlySet<number>): boolean {
  const college = /^c-\d+$/.test(p.slug);
  if (level === 'nfl' && college) return false;
  if (level === 'cfb' && !college) return false;
  if (cls.size) {
    if (!college || p.cls == null) return false;
    return cls.has(Math.min(4, Math.max(1, p.cls)));
  }
  return true;
}
/** Search: a name, an NFL team or (0379) a school. */
export const poolSearchMatch = (p: { full_name: string; team: string; school?: string | null }, needle: string): boolean =>
  !needle || p.full_name.toLowerCase().includes(needle) || p.team.toLowerCase().includes(needle)
  || (p.school ?? '').toLowerCase().includes(needle);

export type PoolSort = 'rank' | 'adp' | 'proj' | 'own' | 'dyn';

export const POOL_SORTS: { id: PoolSort; label: string; hint: string }[] = [
  { id: 'rank', label: 'RANK', hint: "the pool's own order — what autopick follows" },
  { id: 'adp', label: 'ADP', hint: 'consensus average draft position, earliest first' },
  { id: 'proj', label: 'PROJ', hint: 'projected PPR points per game, highest first' },
  { id: 'own', label: 'OWN %', hint: 'share of drafted leagues rostering him' },
  // DYN (v0.351.0, founder: "pull dynasty values from stathead for the draft
  // room and player list in the draft and waivers in dynasty leagues") — the
  // Stathead dynasty market, baked like ADP. Highest first: long-horizon
  // worth, which is the question a dynasty draft is actually asking.
  { id: 'dyn', label: 'DYN', hint: 'dynasty trade value — long-horizon worth, highest first' },
];

export { dynFor, setDynFormat };

// THE LIVE MARKET OVERLAY (v0.306.1, founder: "let's do 1" — the live ESPN
// feed over the baked consensus). Same shape as every other per-league engine
// cache: a module map behind a synchronous getter, installed when a screen
// loads it and cleared on the way out.
//
// It OVERLAYS the bake rather than replacing it. `adp2026.ts` is a consensus
// blend (FantasyPros + Sleeper + FFC) and the feed is ESPN's own draft rooms —
// roughly 13 picks apart at the median — so a player the feed doesn't price,
// or every player when the feed is stale, keeps the consensus number instead of
// falling off the board. A poll failure should cost freshness, not the column.
//
// v0.454.0: the feed is no longer only ESPN's. The worker now refreshes the
// published Sleeper draft-room board daily (0334), which prices each FORMAT
// separately — so a superflex league is handed the 2QB market and a half-PPR
// league its own, neither of which a single baked column can be. The overlay
// mechanism is unchanged; what arrives in it is better, and `adpMeta` carries
// which market it is so a screen can say so instead of claiming "consensus".
let liveAdp: Record<string, number> | null = null;
let liveAdpMeta: AdpMeta | null = null;
export interface AdpMeta {
  source?: 'sleeper' | 'espn' | null;
  format?: 'ppr' | 'half' | 'std' | '2qb' | null;
  asOf?: string | null;
}
export function setLiveAdp(m?: Record<string, number> | null, meta?: AdpMeta | null): void {
  liveAdp = m && Object.keys(m).length ? m : null;
  liveAdpMeta = liveAdp ? meta ?? null : null;
}
export function clearLiveAdp(): void { liveAdp = null; liveAdpMeta = null; }
/** Is the board showing a live market right now? For the label that says so. */
export const adpIsLive = (): boolean => liveAdp != null;
/** Which market the ADP column is showing — for the provenance line under a
 *  player card. Null when the bake is answering. */
export const adpMeta = (): AdpMeta | null => liveAdpMeta;
const FORMAT_LABEL: Record<string, string> = { ppr: 'PPR', half: 'half-PPR', std: 'standard', '2qb': 'superflex' };
/** "Sleeper draft rooms · superflex" / "ESPN draft rooms" / "consensus bake". */
export function adpLabel(bakedAsOf: string): string {
  if (!liveAdpMeta?.source) return `consensus ${bakedAsOf}`;
  const where = liveAdpMeta.source === 'sleeper' ? 'Sleeper draft rooms' : 'ESPN draft rooms';
  const fmt = liveAdpMeta.format ? FORMAT_LABEL[liveAdpMeta.format] : null;
  return fmt ? `${where} · ${fmt}` : where;
}

export const adpFor = (slug: string): number | null =>
  liveAdp?.[slug] ?? adpValue(slug);
// THE PROJECTION IS THE LEAGUE'S, NOT THE BAKE'S (v0.310.0, founder: "so we
// can apply scoring changes to the projections in waivers, drafts and the
// matchup board by league and position?"). It could not: v0.308.0 built the
// league-aware projection and v0.309.0 made it exact, but the only surface
// wired to it was the matchup board's lineup rows. Every pool — waiver wire,
// free agents, the draft room — still sorted and displayed the raw PPR bake, so
// a TE-premium league ranked its tight ends as though it paid nothing extra.
//
// `projectedPoints` reads the catalog the screen installed, so this is the same
// number the board shows for the same player. NO SLOT is passed: a player in a
// pool is not in a lineup, and `scopedAdjustFor` stands a spot-scoped rule aside
// where there is no spot.
//
// NULL STILL MEANS UNKNOWN. `projectedPoints` returns 0 for a player the bake
// has never heard of, and 0 would sort him at the BOTTOM of a descending list
// next to genuinely worthless players — the same claim-from-absence this file
// opens by refusing. So the presence check comes from the bake, and only a
// player it knows gets a number at all. `hasProjection` rather than
// `PROJ_2026.has` (v0.311.0): kickers and defences are baked in a separate file
// from the skill positions, and asking the skill bake about them is how they'd
// stay pinned to the bottom of the very list this was meant to lift them off.
export const projFor = (slug: string, pos?: string | null): number | null =>
  hasProjection(slug, slugSleeperId(slug))
    ? projectedPoints({ id: slug, pos: pos ?? '', team: null })
    : null;

/** One row of any available-player list: the shape both the order and the
 *  displayed value are derived from. `pos` is what makes the projection the
 *  league's — a position premium cannot be applied to a player whose position
 *  we were not told. */
export interface PoolRow { slug: string; pos?: string | null; rank?: number | null }

/** The value a row shows for the order it is sorted by — '—' when the source
 *  doesn't know him, which is also why he sorted last. */
export function poolSortValue(by: PoolSort, row: PoolRow, own?: Record<string, number>): string {
  if (by === 'rank') return row.rank != null ? `#${row.rank}` : '—';
  if (by === 'adp') { const v = adpFor(row.slug); return v != null ? v.toFixed(1) : '—'; }
  if (by === 'proj') { const v = projFor(row.slug, row.pos); return v != null ? `${v.toFixed(1)}/g` : '—'; }
  if (by === 'dyn') { const v = dynFor(row.slug); return v != null ? String(v) : '—'; }
  const o = own?.[row.slug];
  return o != null ? `${o}%` : '0%';
}

/** Order a list of available players. Stable, non-mutating, and rank always
 *  breaks the tie. `own` is the map `playerOwnership` returns (absent = the
 *  ownership order falls back to rank, rather than claiming everyone is 0%
 *  while the call is still in flight). */
export function sortPool<T extends PoolRow>(
  rows: T[], by: PoolSort, own?: Record<string, number> | null,
): T[] {
  const rankOf = (r: T) => r.rank ?? Number.MAX_SAFE_INTEGER;
  if (by === 'rank') return [...rows].sort((a, b) => rankOf(a) - rankOf(b));
  if (by === 'own' && !own) return [...rows].sort((a, b) => rankOf(a) - rankOf(b));
  // Missing sorts last in every order: a key that pushes unknowns to the end
  // whichever direction the known values run.
  const key = (r: T): number => {
    if (by === 'adp') return adpFor(r.slug) ?? Number.MAX_SAFE_INTEGER;
    if (by === 'proj') { const v = projFor(r.slug, r.pos); return v == null ? Number.MAX_SAFE_INTEGER : -v; }
    if (by === 'dyn') { const v = dynFor(r.slug); return v == null ? Number.MAX_SAFE_INTEGER : -v; }
    const o = own?.[r.slug];
    return o == null ? Number.MAX_SAFE_INTEGER : -o;
  };
  return [...rows].sort((a, b) => {
    const d = key(a) - key(b);
    return d !== 0 ? d : rankOf(a) - rankOf(b);
  });
}

// The other two live boards travel with the ADP one (0335) and are installed
// by the same screens, so they are re-exported here rather than making every
// caller import three modules to fill one payload.
export { setLiveDyn, clearLiveDyn, dynIsLive } from './dyn2026';
export { setLivePickValues, clearLivePickValues, pickBoardIsLive } from './pickValues2026';
export { setLiveProjRate, clearLiveProjRate, projIsLive } from '../engine/projScoring';
import { setLiveDyn as _setDyn, clearLiveDyn as _clearDyn } from './dyn2026';
import { setLivePickValues as _setPicks, clearLivePickValues as _clearPicks } from './pickValues2026';
import { setLiveProjRate as _setProj, clearLiveProjRate as _clearProj } from '../engine/projScoring';

/** The shape `league_market` returns, as far as the overlays care. */
export interface LiveMarketPayload {
  adp?: Record<string, number> | null;
  adp_source?: 'sleeper' | 'espn' | null;
  adp_format?: 'ppr' | 'half' | 'std' | '2qb' | null;
  adp_as_of?: string | null;
  dyn?: Record<string, number> | null;
  dyn_format?: '1qb' | 'sf' | null;
  picks?: Record<string, number> | null;
  proj?: Record<string, number> | null;
}
/** Install every overlay one `league_market` call carries. ONE call site's
 *  worth of logic, so the four screens that fetch the market cannot drift. */
export function installLiveMarket(r: LiveMarketPayload): void {
  setLiveAdp(r.adp ?? null, { source: r.adp_source ?? null, format: r.adp_format ?? null, asOf: r.adp_as_of ?? null });
  _setDyn(r.dyn ?? null, r.dyn_format ?? null);
  _setPicks(r.picks ?? null, r.dyn_format ?? null);
  _setProj(r.proj ?? null);
}
/** Drop every market overlay. THE LEAK THIS CLOSES (v0.456.0): the maps are
 *  module-level and slug-keyed, and a slug is the same slug in every league —
 *  so a superflex league's board, left installed, priced the next league's
 *  waiver wire, draft room and trade grades until ITS market call landed. A
 *  screen calls this before it asks for its own market, and the store calls
 *  it when a league is closed, so nothing outlives the league it belongs to. */
export function clearLiveMarket(): void {
  clearLiveAdp(); _clearDyn(); _clearPicks(); _clearProj();
}
