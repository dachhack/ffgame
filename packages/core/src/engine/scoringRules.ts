// THE ONE RULEBOOK — every scoring rule that used to exist twice.
//
// Two resolvers layer cross-slot effects over the shared per-slot resolveSlot:
// matchup.ts `buildMatchup` (the web live board, the demo, the sim) and
// liveResolve.ts `resolveLiveMatchup` (the worker's published rows, the admin
// force-resolve). For most of this project's life each carried its OWN copy of
// the layered rules — best-ball backups, suppress halving, the banker credit,
// the window-battle verdict, the coin economy, the flat buff awards — with a
// comment promising they were "kept in sync by hand". The engine-parity check
// (scripts/check-engine-parity.mjs) measured that promise and found it broken
// four ways at once (v0.339.6): a banker placement that flipped a match
// outcome, a turnover swing the wallet never paid, a phantom week-1 stipend,
// and two different MVP-coin denominators.
//
// v0.340.0 removes the promise instead of re-making it: the rules live HERE,
// once, side-generic, and both resolvers call them. Each function takes a
// `SideLens` — how that engine reads and writes one side of its own slot rows
// — so the rule itself never knows whether it is running over the board's
// `ResolvedSlot` (you/their) or the resolver's `SlotRes` (home/away). A rule
// change in this file is a rule change everywhere at once; a rule change
// anywhere else is a parity failure in the check.
import type { Player, PbpEvent, Pos } from '../types';
import { metricById } from '../data/metrics';
import { hashStr } from '../data/players';
import { turnoversCommitted, hadDefTd, hadLongPassTd } from './sim';

const r1 = (n: number) => Math.round(n * 10) / 10;

// ── The tuned numbers (formerly declared in BOTH engines) ──────────────────
/** Flat drip-coin stipend per week (zero in week 1 — the season opens on the
 *  commissioner's seed budget only). */
export const WEEKLY_STIPEND = 50;
/** Coin bounty for fielding a player nobody opposed. */
export const UNOPPOSED_COIN = 15;
/** Coin for running a suppress DST (it banks no points — this is the pay). */
export const SUPPRESS_COIN = 10;
/** Points awarded to the winner of a window's head-to-head battle. */
export const WINDOW_WIN_BONUS = 5;
/** Window-MVP coin, per slot of the window's CAPACITY (unfilled rows count —
 *  both engines price off capacity as of v0.339.6). */
export const WINDOW_MVP_COIN_PER_SLOT = 5;
/** Coin moved per turnover committed (25 with the Turnover Boost powerup). */
export const TURNOVER_COIN = 10;
/** The Turnover Boost rate. */
export const TURNOVER_COIN_BOOSTED = 25;

/** Coin a metric earns PER EVENT OF NOTE (not per routine play). Only
 *  big-swing metrics produce these — everything else earns 0 from signatures
 *  (the weekly stipend + unopposed bounty carry the baseline). Formerly
 *  declared verbatim in BOTH engines. */
export function metricCoin(pos: Pos, metricId: string | null | undefined): number {
  const m = metricById(pos, metricId);
  if (!m) return 0;
  if (metricId === 'suppress') return SUPPRESS_COIN;                  // suppress firing
  if (metricId === 'neg') return 50;                                 // K SHUTDOWN — the big one
  if (m.fx === 'nuke') return 10;                                    // TD nuke
  // Accumulation drips earn when they go HOT (RB Rush, WR/TE Receiving, Combo).
  if (metricId === 'combodrip' || metricId === 'recyd' || (pos === 'RB' && metricId === 'rush')) return 5;
  return 0;                                                          // routine play — no coin
}
export function coinRisk(n: number): 'HIGH' | 'MED' | 'NONE' {
  return n >= 10 ? 'HIGH' : n > 0 ? 'MED' : 'NONE';
}

/** How one engine's slot rows expose ONE SIDE to the shared rules. `key` must
 *  be the `${win}#${slot}` pairing key both engines already agree on (it is
 *  what sealed_pick stores and what backup assignments address). */
export interface SideLens<S> {
  key(s: S): string;
  win(s: S): string;
  /** This side's fielded player, or null/undefined for an empty half. */
  player(s: S): Player | null | undefined;
  /** This side's metric id (null when nothing is fielded). */
  metric(s: S): string | null | undefined;
  /** The OPPOSING side's player — truthiness decides opposed/unopposed. */
  opp(s: S): Player | null | undefined;
  get(s: S): number;
  set(s: S, v: number): void;
}

// ── Best-ball backups ──────────────────────────────────────────────────────
/** A side's unopposed slots don't score in place: each becomes a BACKUP whose
 *  would-be score can replace one of that side's lowest beatable starter
 *  scores. Manual assignments (keyed `win#slot` → `win#slot`) are honored
 *  first — only when the backup actually outscores the target — then the
 *  unassigned rest auto-maximize greedily (biggest backup into the smallest
 *  beatable starter). All-or-nothing: a backup that doesn't sub in stays 0.
 *  An assigned-but-invalid backup is left benched (the explicit choice is
 *  respected; it does not fall through to auto).
 *
 *  `hooks` let the board record its display bookkeeping (the struck-through
 *  would-be score, the "subbed in for X" chip) without the rule knowing the
 *  row shape. */
export function bestBallBackups<S>(slots: S[], lens: SideLens<S>, assign: Record<string, string> = {}, hooks?: {
  zeroed?: (b: S, wouldBe: number) => void;
  subbed?: (b: S, starter: S, score: number, from: number) => void;
}): void {
  const backups = slots.filter((s) => lens.player(s) && !lens.opp(s));
  if (!backups.length) return;
  const wouldBe = new Map<S, number>();
  for (const b of backups) { wouldBe.set(b, lens.get(b)); hooks?.zeroed?.(b, lens.get(b)); lens.set(b, 0); }

  const starters = slots.filter((s) => lens.player(s) && lens.opp(s));
  const used = new Set<S>();
  const doSub = (b: S, st: S) => {
    hooks?.subbed?.(b, st, wouldBe.get(b)!, lens.get(st));
    lens.set(st, r1(wouldBe.get(b)!));
    used.add(st);
  };

  const auto: S[] = [];
  for (const b of backups) {
    const targetKey = assign[lens.key(b)];
    const st = targetKey ? starters.find((s) => lens.key(s) === targetKey) : undefined;
    if (st && !used.has(st) && wouldBe.get(b)! > lens.get(st)) doSub(b, st);
    else if (!targetKey) auto.push(b);
  }

  const remStarters = starters.filter((s) => !used.has(s)).sort((a, b) => lens.get(a) - lens.get(b));
  auto.sort((a, b) => wouldBe.get(b)! - wouldBe.get(a)!);
  let si = 0;
  for (const b of auto) {
    if (si >= remStarters.length) break;
    const st = remStarters[si];
    if (wouldBe.get(b)! > lens.get(st)) { doSub(b, st); si++; } else break;
  }
}

// ── DEF suppress halving ───────────────────────────────────────────────────
/** Halve every slot of ONE side that scored above 0 and at or below the
 *  OPPOSING suppress threshold. Called once per side, after backups, so a
 *  subbed-in starter score is the one tested. */
export function suppressHalving<S>(slots: S[], lens: SideLens<S>, oppThreshold: number, onHalve?: (s: S, from: number) => void): void {
  if (oppThreshold <= 0) return;
  for (const s of slots) {
    const v = lens.get(s);
    if (v > 0 && v <= oppThreshold) { onHalve?.(s, v); lens.set(s, r1(v * 0.5)); }
  }
}

// ── K banker credit ────────────────────────────────────────────────────────
/** Bake a side's banker bonus (XPs made × TDs scored under TD-counting
 *  metrics) into its FIRST fielded banker-K slot, in slot order — inside the
 *  window, so per-window scores keep summing to the grand total and the bonus
 *  can tip that window's battle. Until v0.339.6 the board added this to the
 *  grand total after the battles instead, and the parity check caught the
 *  difference flipping a match outcome. */
export function bankerCredit<S>(slots: S[], lens: SideLens<S>, bonus: number): void {
  if (bonus <= 0) return;
  const sl = slots.find((s) => lens.player(s)?.pos === 'K' && lens.metric(s) === 'banker');
  if (sl) lens.set(sl, r1(lens.get(sl) + bonus));
}

// ── Window battle verdict ──────────────────────────────────────────────────
/** Who wins a window and what it pays: contested (both sides fielded someone)
 *  and decided by a margin of at least 0.1 — anything closer is a push and
 *  pays nobody. The 0.1 is deliberate: totals are rounded to one decimal, so
 *  a smaller epsilon would let float noise decide a +5. */
export function battleVerdict(aTotal: number, bTotal: number, contested: boolean): { winner: 'a' | 'b' | 'push'; bonus: number } {
  if (contested && Math.abs(aTotal - bTotal) >= 0.1) {
    return { winner: aTotal > bTotal ? 'a' : 'b', bonus: WINDOW_WIN_BONUS };
  }
  return { winner: 'push', bonus: 0 };
}

// ── Armed flat-award buffs ─────────────────────────────────────────────────
/** Trick Play needs no real charting: a deterministic 6% hash per player-week
 *  stands in for "threw a TD pass" until the play feed carries it. */
export function threwTrickTd(playerId: string, week: number): boolean {
  return hashStr(`${playerId}|trickpass|${week}`) % 100 < 6;
}

/** The armed flat-award buffs: id, payout, display label, and the trigger —
 *  ONE table, so an award amount or trigger can never drift between the
 *  board's bonus list and the worker's slot credit. */
export const BUFF_AWARDS: readonly { id: string; pts: number; label: (name: string) => string; hit: (p: Player, week: number) => boolean }[] = [
  { id: 'trick-play', pts: 50, label: (n) => `Trick Play — ${n} threw a TD pass`, hit: (p, week) => p.pos !== 'QB' && threwTrickTd(p.id, week) },
  { id: 'pick-six', pts: 25, label: (n) => `Pick Six — ${n} returned a TD`, hit: (p, week) => p.pos === 'DEF' && hadDefTd(p, week) },
  { id: 'hail-mary', pts: 15, label: (n) => `Hail Mary — ${n} hit a 40+ yd TD`, hit: (p, week) => p.pos === 'QB' && hadLongPassTd(p, week) },
] as const;

// ── The drip-coin economy ──────────────────────────────────────────────────
/** One slot's coin entry as the economy reads it — both engines map their own
 *  row shape into this. */
export interface CoinEntry {
  /** This side's fielded player (entries with neither side can be skipped). */
  player: Player | null | undefined;
  metricId: string | null | undefined;
  /** The opposing player — pays the unopposed bounty when absent, and their
   *  giveaway coin when present (independent of `player`: an opponent-only
   *  slot still pays you their turnovers). */
  opp: Player | null | undefined;
  /** The slot's event stream, with `side` naming which half each event
   *  belongs to ('you' = the side this entry describes). */
  events: readonly PbpEvent[];
  evSide: 'you' | 'their';
}

export interface CoinBreakdown { stipend: number; unopposed: number; signature: number; turnover: number; subtotal: number }

/** The itemized weekly coin for one side — everything EXCEPT the window-MVP
 *  bounty, which needs the settled battles and is added by each caller from
 *  the same WINDOW_MVP_COIN_PER_SLOT × capacity rule. The web's earnings
 *  modal shows this breakdown; the worker banks its total. They are the same
 *  numbers BY CONSTRUCTION now — the parity check caught them apart twice
 *  (the week-1 stipend, the turnover swing) when they were separate code. */
export function coinBreakdown(entries: Iterable<CoinEntry>, week: number, turnoverCoin: number = TURNOVER_COIN): CoinBreakdown {
  const stipend = week <= 1 ? 0 : WEEKLY_STIPEND;
  let unopposed = 0, signature = 0, turnover = 0;
  for (const e of entries) {
    if (e.player) {
      if (!e.opp) unopposed += UNOPPOSED_COIN;
      if (e.metricId === 'suppress') signature += SUPPRESS_COIN;
      const rate = metricCoin(e.player.pos, e.metricId);
      for (const ev of e.events) if (ev.side === e.evSide && ev.coin) signature += ev.coinAmt ?? rate;
      turnover -= turnoverCoin * turnoversCommitted(e.player, week); // your giveaway → you lose
    }
    if (e.opp) turnover += turnoverCoin * turnoversCommitted(e.opp, week); // their giveaway → you gain
  }
  return { stipend, unopposed, signature, turnover, subtotal: stipend + unopposed + signature + turnover };
}
