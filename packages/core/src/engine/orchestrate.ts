// THE CANONICAL POST-SLOT PIPELINE — one ORDER, run by both resolvers.
//
// scoringRules.ts made every layered rule single-sourced; what still lived
// twice after v0.340.0 was the ORCHESTRATION: which effects run, in what
// order, on which side's rows. The parity check caught the cost the day its
// coverage reached the staked effects (v0.341.0): buildMatchup applied
// Double-or-Nothing, the clutch stake, Grudge Match and the flat buff awards
// as post-battle bonuses[] deltas, while resolveLiveMatchup baked them into
// the slot BEFORE the window battles — so the grand totals agreed while the
// window outcomes did not, and a lost halftime stake flipped a window's +5
// officially without the board ever showing it. The banker bug (v0.339.6),
// three more times.
//
// This module owns the order now. Both engines build a PipelineConfig from
// their own input shapes and call applyPostSlotPipeline; every effect is
// side-generic over the SideLens from scoringRules, with display hooks so the
// board keeps its stake chips, siphon tallies and bonus labels. The order is
// the live resolver's — the one that has always decided real weeks:
//
//   backups → suppress → banker → DoN → clutch DoN → awards → rivalry →
//   red herring → lead change → grudge
//
// Window battles stay in each engine (their output shapes differ), but they
// run AFTER this pipeline on slot finals that already carry every effect —
// which is what makes "published rows sum to the total" hold everywhere.
import type { PbpEvent, Player, Pos } from '../types';
import {
  bestBallBackups, suppressHalving, bankerCredit, autoBackupTargets, type SideLens,
} from './scoringRules';
import { stockProjectedPoints } from './projScoring';
import { windowsForWeek } from '../data/nflSlate';

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Grudge Match: win the staked slot by GRUDGE_MARGIN+ → +GRUDGE_SWING;
 *  lose it → −GRUDGE_SWING; anything between pays nothing. */
export const GRUDGE_MARGIN = 10;
export const GRUDGE_SWING = 25;
/** Rivalry: the siphon taken from a same-position mirror's slot score.
 *  0.3 — moved verbatim from matchup.ts; the first draft of this file wrote
 *  0.25 from memory, which is precisely the drift this module exists to end. */
export const RIVALRY_SIPHON = 0.3;
/** Lead Change: points banked each time you seize the lead in an armed slot. */
export const LEAD_CHANGE_BONUS = 2;

/** One side of the pipeline: the lens over the engine's rows plus which event
 *  side ('you'/'their') this side's plays carry in the slot event streams. */
export interface PipelineSide<S> {
  lens: SideLens<S>;
  evSide: 'you' | 'their';
  /** Manual backup assignments, keyed `win#slot` → `win#slot`. */
  backups?: Record<string, string>;
  /** This side's suppress threshold (halves the OPPOSING side's slots). */
  suppress?: number;
  /** This side's banker bonus (XPs made × qualifying TDs). */
  banker?: number;
  /** Double-or-Nothing staked slot key (`win#slot`), if armed. */
  don?: string;
  /** Clutch DoN (Halftime Gamble) staked slot keys. */
  clutchDon?: string[];
  /** Flat award credits already resolved to a slot: the triggering slot's key
   *  and the payout (from scoringRules.BUFF_AWARDS). */
  awards?: { key: string; pts: number }[];
  /** Rivalry-armed window ids. */
  rivalry?: string[];
  /** Red Herring decoy slot keys. */
  redHerring?: string[];
  /** Lead Change armed slot keys. */
  leadChange?: string[];
  /** Grudge Match staked slot keys. */
  grudge?: string[];
  hooks?: {
    /** Best-ball bookkeeping (see scoringRules.bestBallBackups). */
    backupZeroed?: (b: S, wouldBe: number) => void;
    backupSubbed?: (b: S, starter: S, score: number, from: number) => void;
    suppressHalved?: (s: S, from: number) => void;
    /** A stake settled (DoN or clutch DoN): the slot, whether it won, and the
     *  pre-stake score it doubled from / fell from. */
    staked?: (s: S, id: 'double-or-nothing' | 'clutch-don', won: boolean, from: number) => void;
    awarded?: (s: S, key: string, pts: number) => void;
    rivalryTook?: (s: S, take: number) => void;
    herringCapped?: (s: S, from: number) => void;
    leadChanged?: (s: S, bonus: number) => void;
    grudged?: (s: S, verdict: 'won' | 'lost' | 'push', diff: number) => void;
  };
}

export interface PipelineConfig<S> {
  week: number;
  a: PipelineSide<S>;
  b: PipelineSide<S>;
  /** The slot event streams, for Lead Change's seize detection. */
  eventsOf(s: S): readonly PbpEvent[];
}

/** ×2-if-won / 0-if-lost on a head-to-head slot (unopposed or empty slots
 *  can't be staked). Runs on the post-backup/suppress/banker score. */
function settleStake<S>(slots: S[], me: PipelineSide<S>, opp: PipelineSide<S>, key: string, id: 'double-or-nothing' | 'clutch-don'): void {
  const s = slots.find((t) => me.lens.key(t) === key);
  if (!s || !me.lens.player(s) || !opp.lens.player(s)) return;
  const mine = me.lens.get(s), theirs = opp.lens.get(s);
  const won = mine > theirs;
  me.hooks?.staked?.(s, id, won, mine);
  me.lens.set(s, won ? r1(mine * 2) : 0);
}

/** Rivalry: in each armed window, siphon RIVALRY_SIPHON of every same-position
 *  mirror's score to the arming side. */
function rivalrySiphon<S>(slots: S[], me: PipelineSide<S>, opp: PipelineSide<S>): void {
  if (!me.rivalry?.length) return;
  const armed = new Set(me.rivalry);
  for (const s of slots) {
    const mp = me.lens.player(s), op = opp.lens.player(s);
    if (!armed.has(me.lens.win(s)) || !mp || !op || mp.pos !== op.pos) continue;
    const theirs = opp.lens.get(s);
    if (theirs <= 0) continue;
    const take = r1(theirs * RIVALRY_SIPHON);
    opp.lens.set(s, r1(theirs - take));
    me.lens.set(s, r1(me.lens.get(s) + take));
    me.hooks?.rivalryTook?.(s, take);
  }
}

/** Red Herring: each armed decoy caps every opposing same-position player in
 *  the decoy's window at the decoy's own total (never raises them). */
function redHerringCap<S>(slots: S[], me: PipelineSide<S>, opp: PipelineSide<S>): void {
  if (!me.redHerring?.length) return;
  const armed = new Set(me.redHerring);
  for (const decoy of slots) {
    const dp = me.lens.player(decoy);
    if (!dp || !armed.has(me.lens.key(decoy))) continue;
    const cap = me.lens.get(decoy);
    for (const s of slots) {
      if (me.lens.win(s) !== me.lens.win(decoy)) continue;
      const op = opp.lens.player(s);
      if (!op || op.pos !== dp.pos) continue;
      if (opp.lens.get(s) > cap) { me.hooks?.herringCapped?.(s, opp.lens.get(s)); opp.lens.set(s, cap); }
    }
  }
}

/** Lead Change: +LEAD_CHANGE_BONUS each time this side SEIZED the lead
 *  (overtook after trailing) in an armed head-to-head slot's timeline. */
function leadChangeBonus<S>(slots: S[], me: PipelineSide<S>, opp: PipelineSide<S>, eventsOf: (s: S) => readonly PbpEvent[]): void {
  if (!me.leadChange?.length) return;
  const armed = new Set(me.leadChange);
  for (const s of slots) {
    if (!me.lens.player(s) || !opp.lens.player(s) || !armed.has(me.lens.key(s))) continue;
    const evs = [...eventsOf(s)].sort((x, y) => x.clock - y.clock);
    let prev: 'you' | 'their' | 'tie' = 'tie', seizes = 0;
    for (const e of evs) {
      const lead: 'you' | 'their' | 'tie' = e.youBank > e.theirBank ? 'you' : e.theirBank > e.youBank ? 'their' : 'tie';
      if (lead === me.evSide && prev !== 'tie' && prev !== me.evSide) seizes++;
      if (lead !== 'tie') prev = lead;
    }
    if (seizes > 0) {
      const bonus = seizes * LEAD_CHANGE_BONUS;
      me.lens.set(s, r1(me.lens.get(s) + bonus));
      me.hooks?.leadChanged?.(s, bonus);
    }
  }
}

/** Grudge Match: win the staked head-to-head by GRUDGE_MARGIN+ → +GRUDGE_SWING,
 *  lose it → −GRUDGE_SWING, anything between pays nothing. */
function grudgeStake<S>(slots: S[], me: PipelineSide<S>, opp: PipelineSide<S>): void {
  if (!me.grudge?.length) return;
  const armed = new Set(me.grudge);
  for (const s of slots) {
    if (!me.lens.player(s) || !opp.lens.player(s) || !armed.has(me.lens.key(s))) continue;
    const diff = me.lens.get(s) - opp.lens.get(s);
    if (diff >= GRUDGE_MARGIN) { me.lens.set(s, r1(me.lens.get(s) + GRUDGE_SWING)); me.hooks?.grudged?.(s, 'won', diff); }
    else if (diff < 0) { me.lens.set(s, r1(me.lens.get(s) - GRUDGE_SWING)); me.hooks?.grudged?.(s, 'lost', diff); }
    else me.hooks?.grudged?.(s, 'push', diff); // no swing — display still shows the push
  }
}

/** Flat award credits (Trick Play / Pick Six / Hail Mary), landed on the
 *  triggering slot so per-window sums still equal the totals. */
function awardCredits<S>(slots: S[], me: PipelineSide<S>): void {
  for (const a of me.awards ?? []) {
    const s = slots.find((t) => me.lens.key(t) === a.key);
    if (s) { me.lens.set(s, r1(me.lens.get(s) + a.pts)); me.hooks?.awarded?.(s, a.key, a.pts); }
  }
}

/** The side with its DoN, clutch DoN and Grudge keys moved off each subbed
 *  backup's slot onto the starter slot it covered. A key already on that
 *  starter slot is not doubled up. Lead Change stays put: it reads the slot's
 *  play timeline, which is the starter's, not the backup's. */
function followBackups<S>(sd: PipelineSide<S>, moved: Map<string, string>): PipelineSide<S> {
  if (!moved.size) return sd;
  const to = (k: string) => moved.get(k) ?? k;
  const list = (ks?: string[]) => ks && [...new Set(ks.map(to))];
  return { ...sd, don: sd.don && to(sd.don), clutchDon: list(sd.clutchDon), grudge: list(sd.grudge) };
}

/** Position:metric pairs that bank nothing themselves: their effect (Field
 *  General's multiplier, Negation's shutdown, Suppress's bar) runs off the
 *  player's plays whatever the slot's score, so a backup covering one costs
 *  nothing, and one fielded as a backup has nothing to give. */
export const BANKS_NOTHING_METRICS = new Set(['QB:fg', 'K:neg', 'DEF:suppress']);
export const banksNothing = (pos: string | undefined, metric: string | null | undefined): boolean =>
  BANKS_NOTHING_METRICS.has(`${pos ?? ''}:${metric ?? ''}`);

/** The blind auto-pick's target order for one side (scoringRules
 *  .autoBackupTargets): the slots that bank nothing first, then the lowest
 *  stock projection. Pre-game facts only, the same on every engine. */
export function blindBackupRank<S>(lens: SideLens<S>): (s: S) => number {
  return (s) => {
    const p = lens.player(s);
    if (!p) return Number.POSITIVE_INFINITY;
    if (banksNothing(p.pos, lens.metric(s))) return -1;
    return stockProjectedPoints(p);
  };
}

/** One of the viewer's spots as a board sees it, for the backup strip. */
export interface BackupBoardRow {
  /** `win#slot`. */
  key: string;
  win: string;
  slug: string | null;
  pos: string | null;
  metric: string | null;
  /** The opponent fields a player facing this spot. A board passes `true`
   *  for a spot in a window still sealed unless the server has said the
   *  opponent left that window empty (opponent_empty_windows), so the strip
   *  learns nothing a sealed lineup hides. */
  opposed: boolean;
}

/** THE BACKUP STRIP'S ANSWER (v0.735.0), the same rule the resolver scores:
 *  which of the viewer's spots are backups, and the blind pick for each one
 *  without a manual assignment. Both boards call this rather than running the
 *  engine, so the strip names the target the worker will use. */
export function backupPlanForBoard(week: number, rows: BackupBoardRow[], assign: Record<string, string>): { backups: string[]; auto: Record<string, string> } {
  const order = windowsForWeek(week).map((w) => w.id);
  const winRank = (win: string) => order.indexOf(win);
  const OPP = { id: '', name: '', full: '', pos: 'WR', team: '', stats: {} } as unknown as Player;
  const lens: SideLens<BackupBoardRow> = {
    key: (r) => r.key, win: (r) => r.win,
    player: (r) => (r.slug ? ({ ...OPP, id: r.slug, name: r.slug, full: r.slug, pos: (r.pos ?? 'WR') as Pos }) : undefined),
    metric: (r) => r.metric, opp: (r) => (r.opposed ? OPP : undefined),
    get: () => 0, set: () => {},
  };
  const opposedWins = new Set(rows.filter((r) => r.opposed).map((r) => r.win));
  const backups = rows.filter((r) => r.slug && !r.opposed && !opposedWins.has(r.win) && !banksNothing(r.pos ?? undefined, r.metric)).map((r) => r.key);
  return { backups, auto: autoBackupTargets(rows, lens, assign, winRank, blindBackupRank(lens)) };
}

/** THE PIPELINE. Runs every post-slot effect in the canonical order, for both
 *  sides, mutating slot finals in place. Battles run after this, per engine. */
export function applyPostSlotPipeline<S>(slots: S[], cfg: PipelineConfig<S>): void {
  const { a, b } = cfg;
  // Window kickoff order for the backup rule (v0.388.3): a backup covers its
  // own window or a later one, never one that already played.
  const order = windowsForWeek(cfg.week).map((w) => w.id);
  const winRank = (win: string) => order.indexOf(win);
  // A backup's slot-targeted head-to-head stakes follow him into the slot he
  // covers (v0.734.0). Gridiron Gang, week 7: Double or Nothing and Grudge on
  // Caleb Williams' unopposed TNF spot did nothing, though his score subbed in
  // for SNF. A stake on an unopposed slot can't settle; on the covered one it
  // can, so the backup's key is remapped there before the stakes run.
  const backup = (sd: PipelineSide<S>) => {
    const moved = new Map<string, string>();
    bestBallBackups(slots, sd.lens, sd.backups ?? {}, {
      zeroed: sd.hooks?.backupZeroed, winRank, blindRank: blindBackupRank(sd.lens),
      subbed: (bk, st, score, from) => { moved.set(sd.lens.key(bk), sd.lens.key(st)); sd.hooks?.backupSubbed?.(bk, st, score, from); },
    });
    return followBackups(sd, moved);
  };
  const A = backup(a), B = backup(b);
  suppressHalving(slots, a.lens, b.suppress ?? 0, a.hooks?.suppressHalved);
  suppressHalving(slots, b.lens, a.suppress ?? 0, b.hooks?.suppressHalved);
  bankerCredit(slots, a.lens, a.banker ?? 0);
  bankerCredit(slots, b.lens, b.banker ?? 0);
  if (A.don) settleStake(slots, A, B, A.don, 'double-or-nothing');
  if (B.don) settleStake(slots, B, A, B.don, 'double-or-nothing');
  for (const k of A.clutchDon ?? []) settleStake(slots, A, B, k, 'clutch-don');
  for (const k of B.clutchDon ?? []) settleStake(slots, B, A, k, 'clutch-don');
  awardCredits(slots, a);
  awardCredits(slots, b);
  rivalrySiphon(slots, a, b);
  rivalrySiphon(slots, b, a);
  redHerringCap(slots, a, b);
  redHerringCap(slots, b, a);
  leadChangeBonus(slots, a, b, cfg.eventsOf);
  leadChangeBonus(slots, b, a, cfg.eventsOf);
  grudgeStake(slots, A, B);
  grudgeStake(slots, B, A);
}
