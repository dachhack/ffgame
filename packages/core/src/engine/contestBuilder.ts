// THE SQUAD BUILDER (v0.665.0) — docs/dfs-bullseye.md §14. Founder: "We want
// the budget and player selection to be a rich, interactive, fun experience
// on web and app." The pure half of the builder both clients draw: which
// spots a board player may stand in and why not (the spot's own filter, the
// league's pool filter, the seat's rule), what a spot can still afford, how
// the pick sheet ranks, and what fills the open spots for you. The server
// (save_contest_entry) remains the authority; this is what greys a player out
// before you tap him.
import type { ClassicSlotDef } from './classic';
import { TEAM_UNIT_POS, slotEligiblePos } from './classic';
import { seatRuleAllows, seatRuleText, normTeam, type SeatRule } from '../data/seatRules';
import { contestSlotAllows, contestAutoBuild, CONTEST_MIN_SALARY, type ContestConfig, type ContestBoardPlayer } from './contest';
import type { BullseyeCard } from './bullseye';
import { projectedPoints, setLeagueProjScoring, clearLeagueProjScoring, withPprProjections, hcWeekPoints, type HcGame } from './projScoring';
import { normalizeClassicScoring, type ClassicScoring } from './classic';

export interface BuilderPlayer extends ContestBoardPlayer {
  name: string; team: string;
  /** The projection the salary was set from (0467), and the feed's current
   *  number before the league's scaling — the "priced 15.4 ↑" readout. */
  priced?: number | null; feedProj?: number;
}
/** "↑ 2.7 since priced" / "↓ 1.1 since priced" — null inside half a point. */
export function pricedDelta(p: { priced?: number | null; feedProj?: number; proj: number }): { dir: '↑' | '↓'; by: number } | null {
  const now = p.feedProj ?? p.proj;
  if (p.priced == null || !Number.isFinite(Number(p.priced))) return null;
  const d = Math.round((now - Number(p.priced)) * 10) / 10;
  return Math.abs(d) < 0.5 ? null : { dir: d > 0 ? '↑' : '↓', by: Math.abs(d) };
}
export interface PoolFilter { teams?: string[] | null; min_exp?: number | null; max_exp?: number | null }
export interface BuilderCtx {
  slots: ClassicSlotDef[];
  cfg: ContestConfig;
  picks: Record<string, string | null>;
  seatRule?: SeatRule | null;
  poolFilter?: PoolFilter | null;
  card?: BullseyeCard | null;
}
export type BuilderSort = 'proj' | 'salary' | 'value' | 'aim' | 'name';
export const BUILDER_SORTS: { id: BuilderSort; label: string }[] = [
  { id: 'proj', label: 'PROJ' }, { id: 'value', label: 'VALUE' }, { id: 'salary', label: 'SALARY' }, { id: 'name', label: 'A–Z' },
];

/** What to call a position on a tab. */
export const posLabel = (pos: string): string => (pos === 'DEF' ? 'D/ST' : pos);

/** The pick sheet's position tabs: every position the league's spots take,
 *  in the order the spots name them, ALL first. */
export function builderTabs(slots: ClassicSlotDef[]): string[] {
  const out: string[] = [];
  for (const d of slots) for (const p of slotEligiblePos(d.pos)) if (!out.includes(p)) out.push(p);
  return ['ALL', ...out];
}

/** Does the league's pool filter admit this player? Teams, and a tenure
 *  window that team units (K, DEF, HC, P) sit outside of — the SQL's rule. */
export function poolFilterAllows(pf: PoolFilter | null | undefined, p: { pos: string; team?: string | null; exp?: number | null }): boolean {
  if (!pf) return true;
  if (pf.teams?.length && !pf.teams.map(normTeam).includes(normTeam(p.team))) return false;
  if ((pf.min_exp != null || pf.max_exp != null) && !TEAM_UNIT_POS.has(p.pos)) {
    if (p.exp == null) return false;
    if (pf.min_exp != null && p.exp < pf.min_exp) return false;
    if (pf.max_exp != null && p.exp > pf.max_exp) return false;
  }
  return true;
}

const tenureWord = (mn?: number | null, mx?: number | null): string =>
  mn === 0 && mx === 0 ? 'rookies only' : mn != null && mx != null ? `${mn}–${mx} yrs only` : mn != null ? `${mn}+ yrs only` : `up to ${mx} yrs only`;

/** Why this player can't stand in this spot — null when he can. Position
 *  first, then the spot's own filter, the pool filter, the seat's rule. */
export function spotWhyNot(d: ClassicSlotDef, p: BuilderPlayer, ctx: Pick<BuilderCtx, 'seatRule' | 'poolFilter'>): string | null {
  if (!slotEligiblePos(d.pos).includes(p.pos)) return `not a ${slotEligiblePos(d.pos).map(posLabel).join('/')}`;
  if (!contestSlotAllows(d, p)) {
    const f = d.flt;
    if (f?.teams?.length && !f.teams.map(normTeam).includes(normTeam(p.team))) return `this spot takes ${f.teams.length <= 4 ? f.teams.join('/') : `${f.teams.length} teams`} only`;
    if ((f?.min_exp != null || f?.max_exp != null) && !TEAM_UNIT_POS.has(p.pos)) return `this spot is ${tenureWord(f?.min_exp, f?.max_exp)}`;
    if (f?.flags?.length) return `this spot needs the ${f.flags.join('/')} flag`;
    return 'not eligible for this spot';
  }
  if (!poolFilterAllows(ctx.poolFilter, p)) {
    const pf = ctx.poolFilter!;
    if (pf.teams?.length && !pf.teams.map(normTeam).includes(normTeam(p.team))) return 'outside the league’s team pool';
    return `the league is ${tenureWord(pf.min_exp, pf.max_exp)}`;
  }
  if (ctx.seatRule && !seatRuleAllows(ctx.seatRule, p)) return `your seat takes ${seatRuleText(ctx.seatRule) || 'some players'} only`;
  return null;
}

/** Every spot, with whether this player may stand in it. */
export const spotsFor = (p: BuilderPlayer, ctx: BuilderCtx): { slot: string; ok: boolean; why: string | null }[] =>
  ctx.slots.map((d) => { const why = spotWhyNot(d, p, ctx); return { slot: d.slot, ok: !why, why }; });

/** The open spot this player should land in when no spot is chosen: the
 *  tightest one that takes him (a single-position spot before a FLEX). */
export function openSpotFor(p: BuilderPlayer, ctx: BuilderCtx): string | null {
  const open = ctx.slots.filter((d) => !ctx.picks[d.slot] && !spotWhyNot(d, p, ctx));
  if (!open.length) return null;
  return [...open].sort((a, b) => slotEligiblePos(a.pos).length - slotEligiblePos(b.pos).length)[0].slot;
}

export const builderSpent = (ctx: Pick<BuilderCtx, 'picks'>, salaryOf: (slug: string) => number): number =>
  Object.values(ctx.picks).reduce((s, slug) => s + (slug ? salaryOf(slug) : 0), 0);

/** The most this spot can spend: what's left after the other picks, less the
 *  minimum each other open spot still needs. */
export function roomFor(ctx: BuilderCtx, slot: string, salaryOf: (slug: string) => number): number {
  const cur = ctx.picks[slot];
  const others = ctx.slots.filter((d) => d.slot !== slot && !ctx.picks[d.slot]).length;
  return ctx.cfg.budget - builderSpent(ctx, salaryOf) + (cur ? salaryOf(cur) : 0) - others * CONTEST_MIN_SALARY;
}

/** Projected points per $1,000 — the sheet's VALUE. */
export const valueOf = (p: { salary: number; proj: number }): number => (p.salary > 0 ? Math.round((p.proj / (p.salary / 1000)) * 100) / 100 : 0);

/** THE LEAGUE'S OWN NUMBER (v0.666.0). The board's projection is PPR points
 *  from the weekly feed — the shared price sheet. A league scoring half-PPR,
 *  TE-premium or paying coaches sees its own: the weekly feed scaled by the
 *  season projection under the league's catalog over the same under stock
 *  PPR (bounded, so a thin season line can't swing it), and for a body the
 *  feed does not price at all (HC, P) the league catalog's per-week number
 *  outright. Pure of the clock; installs and clears the catalog around the
 *  read. */
export function leagueWeekProj(row: { slug: string; pos: string; team?: string | null; proj: number }, catalog?: Partial<ClassicScoring> | null,
  /** A COACH'S WEEK (v0.667.2): his game this week (null = bye) prices him
   *  for THAT matchup; undefined (slate unknown) falls back to the flat
   *  seventeenth below. Ignored for anyone but a head coach. */
  game?: HcGame | null): number {
  if (!catalog) return row.proj;
  if (row.pos === 'HC' && game !== undefined) {
    const n = hcWeekPoints(row.slug, game, normalizeClassicScoring(catalog));
    if (n != null) return n;
  }
  const who = { id: row.slug, pos: row.pos, team: row.team ?? null };
  let lg = 0;
  try { setLeagueProjScoring(catalog); lg = projectedPoints(who); } finally { clearLeagueProjScoring(); }
  const ppr = withPprProjections(() => projectedPoints(who));
  const r1 = (n: number) => Math.round(n * 10) / 10;
  if (!(row.proj > 0)) return lg > 0 ? r1(lg) : row.proj;
  if (!(ppr > 0) || !(lg > 0)) return row.proj;
  const ratio = Math.max(0.5, Math.min(2, lg / ppr));
  return r1(row.proj * ratio);
}

export interface BuilderRow {
  p: BuilderPlayer;
  /** The spot he'd land in — the chosen one, else the tightest open one. */
  slot: string | null;
  fits: boolean;
  why: string | null;
  afford: boolean;
  over: number;
  lock: boolean;
  /** Which of my spots already holds him. */
  taken: string | null;
  dist: number | null;
  value: number;
}

/** The pick sheet, ranked. `slot` null means no spot chosen: every player
 *  shows, landing in the tightest open spot that takes him. */
export function rankCandidates(board: BuilderPlayer[], ctx: BuilderCtx, o: {
  slot?: string | null; tab?: string; team?: string | null; needle?: string; sort?: BuilderSort;
  locked?: (slug: string) => boolean; hideIneligible?: boolean;
  /** RULED OUT (v0.666.0): the injury report's O and IR. Not a new pick —
   *  the server refuses him too — but one already in the saved squad stays
   *  (and swappable until his game locks). */
  ruledOut?: (slug: string) => boolean; saved?: Record<string, string | null>;
}, salaryOf: (slug: string) => number): BuilderRow[] {
  const bull = ctx.cfg.contest === 'bullseye' && ctx.cfg.bullseye?.variant === 'slots' && !!ctx.card;
  const sort: BuilderSort = o.sort ?? (bull ? 'aim' : ctx.cfg.contest === 'golf' ? 'proj' : 'proj');
  const needle = (o.needle ?? '').trim().toLowerCase();
  const def = o.slot ? ctx.slots.find((d) => d.slot === o.slot) ?? null : null;
  const room = def ? roomFor(ctx, def.slot, salaryOf) : null;
  const takenBy = new Map<string, string>();
  for (const [s, v] of Object.entries(ctx.picks)) if (v) takenBy.set(v, s);
  const rows: BuilderRow[] = [];
  for (const p of board) {
    if (o.tab && o.tab !== 'ALL' && p.pos !== o.tab) continue;
    if (o.team && normTeam(p.team) !== normTeam(o.team)) continue;
    if (needle && !p.name.toLowerCase().includes(needle) && !p.team.toLowerCase().includes(needle)) continue;
    const taken = takenBy.get(p.slug) ?? null;
    const land = def ? def.slot : openSpotFor(p, ctx);
    const landDef = land ? ctx.slots.find((d) => d.slot === land)! : null;
    const inSaved = !!o.saved && Object.values(o.saved).includes(p.slug);
    const out = !!o.ruledOut?.(p.slug) && !inSaved;
    const why = out ? 'ruled out this week'
      : def ? spotWhyNot(def, p, ctx) : landDef ? null : (ctx.slots.some((d) => !spotWhyNot(d, p, ctx)) ? 'every spot he fits is filled' : spotWhyNot(ctx.slots.find((d) => slotEligiblePos(d.pos).includes(p.pos)) ?? ctx.slots[0], p, ctx));
    const fits = !why && !!land;
    const r = def ? room! : land ? roomFor(ctx, land, salaryOf) : 0;
    const afford = fits && p.salary <= r;
    const target = landDef && ctx.card ? ctx.card.targets[landDef.slot] : null;
    if (o.hideIneligible && (!fits || taken)) continue;
    rows.push({ p, slot: land, fits, why, afford, over: fits ? Math.max(0, p.salary - r) : 0, lock: o.locked?.(p.slug) ?? false, taken: taken && taken !== o.slot ? taken : null,
      dist: target != null ? Math.round(Math.abs(p.proj - target) * 10) / 10 : null, value: valueOf(p) });
  }
  const golf = ctx.cfg.contest === 'golf';
  const key = (r: BuilderRow): number => {
    switch (sort) {
      case 'aim': return r.dist ?? 999;
      case 'salary': return -r.p.salary;
      case 'value': return golf ? (r.p.proj > 0 ? -1 / Math.max(0.01, r.value) : 999) : -r.value;
      case 'name': return 0;
      default: return golf ? (r.p.proj > 0 ? r.p.proj : 999) : -r.p.proj;
    }
  };
  // The ones you can take first; among them the sort; then the rest.
  rows.sort((a, b) => Number(!(a.fits && a.afford && !a.lock && !a.taken)) - Number(!(b.fits && b.afford && !b.lock && !b.taken))
    || key(a) - key(b) || (sort === 'name' ? a.p.name.localeCompare(b.p.name) : a.p.salary - b.p.salary));
  return rows;
}

/** FILL FOR ME: the open spots, built the way the contest wants, around the
 *  picks already made and inside what's left of the budget. A player the
 *  pool filter or seat rule refuses is never offered. */
export function fillOpenSpots(board: BuilderPlayer[], ctx: BuilderCtx, seed: string, ruledOut?: (slug: string) => boolean): Record<string, string | null> {
  const pool = board.filter((p) => poolFilterAllows(ctx.poolFilter, p) && seatRuleAllows(ctx.seatRule, p) && !ruledOut?.(p.slug));
  return contestAutoBuild(pool, ctx.cfg, seed, ctx.card ?? null, ctx.picks);
}

/** The budget bar's words: what's left, and per open spot. `capped` false
 *  (v0.668.0) means there is no cap — `left` and `perSpot` are then just
 *  large; `floor` is the minimum spend (0 = none) and `short` how far the
 *  squad still is below it. */
export function budgetLine(ctx: BuilderCtx, salaryOf: (slug: string) => number): { spent: number; left: number; open: number; perSpot: number; over: boolean; capped: boolean; floor: number; short: number } {
  const spent = builderSpent(ctx, salaryOf);
  const open = ctx.slots.filter((d) => !ctx.picks[d.slot]).length;
  const left = ctx.cfg.budget - spent;
  const floor = ctx.cfg.minSpend ?? 0;
  return { spent, left, open, perSpot: open ? Math.floor(left / open / 100) * 100 : 0, over: ctx.cfg.capped !== false && left < 0,
    capped: ctx.cfg.capped !== false, floor, short: floor > 0 ? Math.max(0, floor - spent) : 0 };
}
