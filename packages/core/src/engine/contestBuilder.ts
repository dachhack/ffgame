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

export interface BuilderPlayer extends ContestBoardPlayer { name: string; team: string }
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
    const why = def ? spotWhyNot(def, p, ctx) : landDef ? null : (ctx.slots.some((d) => !spotWhyNot(d, p, ctx)) ? 'every spot he fits is filled' : spotWhyNot(ctx.slots.find((d) => slotEligiblePos(d.pos).includes(p.pos)) ?? ctx.slots[0], p, ctx));
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
export function fillOpenSpots(board: BuilderPlayer[], ctx: BuilderCtx, seed: string): Record<string, string | null> {
  const pool = board.filter((p) => poolFilterAllows(ctx.poolFilter, p) && seatRuleAllows(ctx.seatRule, p));
  return contestAutoBuild(pool, ctx.cfg, seed, ctx.card ?? null, ctx.picks);
}

/** The budget bar's words: what's left, and per open spot. */
export function budgetLine(ctx: BuilderCtx, salaryOf: (slug: string) => number): { spent: number; left: number; open: number; perSpot: number; over: boolean } {
  const spent = builderSpent(ctx, salaryOf);
  const open = ctx.slots.filter((d) => !ctx.picks[d.slot]).length;
  const left = ctx.cfg.budget - spent;
  return { spent, left, open, perSpot: open ? Math.floor(left / open / 100) * 100 : 0, over: left < 0 };
}
