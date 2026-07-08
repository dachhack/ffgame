// Shared live/preview resolver — the single source of truth for resolving a
// real H2H matchup from slug-keyed sealed picks. Used by BOTH the in-browser
// admin force-resolve (src/data/forceResolve.ts) and the Fly worker
// (server/src/resolve.js via engine.js), so the founder's preview and the live
// worker always produce identical scores.
//
// It layers the cross-slot niceties that per-slot resolveSlot can't see, the
// way the demo's buildMatchup does, but driven by injected Sleeper players
// rather than the static demo league:
//   • Cross-window Field General — a QB on the `fg` metric builds a window-wide
//     multiplier on its own side's other slots in that window (scores 0 itself).
//   • Best-ball backups — an unopposed player doesn't score in place; the biggest
//     such backup subs for the side's lowest beatable starter. All-or-nothing:
//     a backup that doesn't sub in scores 0.
//   • TE Touchdown 8-PT NUKE — each TE TD in a window knocks every opposing
//     drip rate down by 1.0 across that window (wired through resolveSlot's
//     drip-nuke clocks).
//   • DEF SUPPRESS halving — a DST on `suppress` banks 0 itself; its defensive
//     earn score is the kill-threshold, halving every OPPOSING slot (any
//     window) that scored at or below it. Highest threshold wins per side.
//   • K BANKER XP bonus — +1 to each of your TDs per banker XP made. Applied
//     after backups + suppress, baked into the banker K's window so per-window
//     scores still sum to the grand total.
//   • Drip-coin economy — weekly stipend + unopposed bounty + per-event-of-note
//     coin, returned per side. (No DB sink yet; surfaced for a future column.)
import type { Player, PbpEvent, Pos } from '../types';
import { metricById } from '../data/metrics';
import { capAmplifiers } from '../data/powerups';
import { REAL_WEEKS } from '../data/realPbp';
import { resolveSlot, windowFgMult, teTdNukeClocks, defEarnScore, hadDefTd, hadLongPassTd, clockAtRealTime, EMPTY_PLAYER, type SlotInput } from './sim';
import { banksAtClock, threwTrickTd } from './matchup';

export interface LivePick { win: string; slot: string; player: Player; metricId: string; }
export interface LiveWindowScore { window: string; home: number; away: number; }
export interface SlotScore {
  win: string; slot: string; side: 'home' | 'away'; slug: string; metric: string | null; score: number;
  /** This side's drip went HOT at some point in the window (🔥 badge). */
  hot?: boolean;
  /** This side SUFFERED a nuke (TD-nuke bank wipe or TE-TD drip nuke) — the card scorches. */
  nuked?: boolean;
}
export interface LiveResult {
  states: LiveWindowScore[];          // per-window scores, post-backup (sum to the totals)
  slots: SlotScore[];                 // per-player scores after all adjustments
  home: number; away: number;         // grand totals
  coin: { home: number; away: number };
}

const round = (n: number) => Math.round(n * 10) / 10;

// ── Drip-coin economy (mirrors src/engine/matchup.ts; kept in sync by hand) ──
const WEEKLY_STIPEND = 50, UNOPPOSED_COIN = 15, SUPPRESS_COIN = 10;
function metricCoin(pos: Pos, metricId: string | null | undefined): number {
  const m = metricById(pos, metricId);
  if (!m) return 0;
  if (metricId === 'suppress') return SUPPRESS_COIN;
  if (metricId === 'neg') return 50;
  if (m.fx === 'nuke') return 10;
  if (metricId === 'combodrip' || metricId === 'recyd' || (pos === 'RB' && metricId === 'rush')) return 5;
  return 0;
}

interface SlotRes {
  win: string; slot: string;
  homeP: Player | null; awayP: Player | null;
  homeMetric: string | null; awayMetric: string | null;
  home: number; away: number;
  events: PbpEvent[];
}

/** Best-ball backups for one side: unopposed players (present, no opponent in
 *  the slot) don't score in place; the biggest backup subs for the lowest
 *  beatable starter. All-or-nothing — a backup that doesn't sub in scores 0. */
function applyBackups(slots: SlotRes[], side: 'home' | 'away'): void {
  const meP = (s: SlotRes) => (side === 'home' ? s.homeP : s.awayP);
  const opP = (s: SlotRes) => (side === 'home' ? s.awayP : s.homeP);
  const getF = (s: SlotRes) => (side === 'home' ? s.home : s.away);
  const setF = (s: SlotRes, v: number) => { if (side === 'home') s.home = v; else s.away = v; };

  const backups = slots.filter((s) => meP(s) && !opP(s));
  if (!backups.length) return;
  // A backup doesn't score on its own — record its would-be score, zero it out.
  const score = new Map<SlotRes, number>();
  for (const b of backups) { score.set(b, getF(b)); setF(b, 0); }

  // Greedily sub the biggest backups into the lowest beatable starters.
  const starters = slots.filter((s) => meP(s) && opP(s)).sort((a, b) => getF(a) - getF(b));
  const ranked = [...backups].sort((a, b) => (score.get(b)! - score.get(a)!));
  const used = new Set<SlotRes>();
  let si = 0;
  for (const b of ranked) {
    if (si >= starters.length) break;
    const st = starters[si];
    if (score.get(b)! > getF(st)) { setF(st, round(score.get(b)!)); used.add(b); si++; } else break;
  }
  // All-or-nothing: backups that didn't sub in stay 0 (zeroed above).
}

function coinFor(slots: SlotRes[], side: 'home' | 'away'): number {
  const meP = (s: SlotRes) => (side === 'home' ? s.homeP : s.awayP);
  const meM = (s: SlotRes) => (side === 'home' ? s.homeMetric : s.awayMetric);
  const opP = (s: SlotRes) => (side === 'home' ? s.awayP : s.homeP);
  const evSide = side === 'home' ? 'you' : 'their';
  let c = WEEKLY_STIPEND;
  for (const s of slots) {
    const p = meP(s);
    if (!p) continue;
    if (!opP(s)) c += UNOPPOSED_COIN;
    if (meM(s) === 'suppress') c += SUPPRESS_COIN;
    const rate = metricCoin(p.pos, meM(s));
    for (const e of s.events) if (e.side === evSide && e.coin) c += e.coinAmt ?? rate;
  }
  return Math.round(c);
}

/** Pre-match team buffs each side has armed (overtime / ot-shield / momentum /
 *  garbage-time / floodgates / counter-nuke / insurance / fg-stack). These are
 *  the in-slot buffs resolveSlot + windowFgMult already understand — the live
 *  path simply hands them through, the way the demo's buildMatchup does.
 *  Trick Play / Pick Six / Hail Mary also arrive in these sets — they're armed
 *  team buffs; their flat awards resolve here (see awardFor). */
export interface LiveBuffs {
  homeBuffs?: Set<string>; awayBuffs?: Set<string>;
  /** Combo-Drip unlocks purchased this week, per side (one combodrip slot per
   *  purchase). Defaults to 1 — the single-unlock loadout every legacy caller
   *  (playtester, forceResolve) represents with a plain `unlocks` set. */
  homeComboQty?: number; awayComboQty?: number;
}

/** A side's real-time slot swap (Metric Swap / Player Swap / Mulligan). Cuts
 *  over at atRt (real seconds since the pre-swap player's first snap) mapped
 *  onto the game clock — or at atClock when no real timestamp exists. Pre-swap
 *  banked points are kept; only the new config's post-cut gains add on. */
export interface LiveSwap { toMetricId?: string; toPlayer?: Player; atClock: number; atRt?: number; }

/** Targeted power-ups one side has applied (the live counterpart of the demo's
 *  buildMatchup extras). All optional; keys of `swaps`/`don` are `${win}|${slot}`. */
export interface LiveExtras {
  /** Double or Nothing: the staked slot scores ×2 if it wins its head-to-head at
   *  FINAL, 0 if it loses. Resolved after backups/suppress/banker, baked into
   *  the slot so window sums still equal the totals. */
  don?: { win: string; slot: string };
  /** Bye Steal: fill an empty slot with a bye player for a flat score. `pts` is
   *  the projection recorded at apply time — CLAMPED by the RPC and again here
   *  (a client-supplied number is never trusted past BYE_STEAL_CAP). When the
   *  opponent fields nobody across from it, the filled slot follows the normal
   *  unopposed→backup rule like any other unopposed player (buildMatchup
   *  behaves the same); against an opponent it banks the flat score directly. */
  byeSteal?: { win: string; slot: string; player: Player; pts: number };
  /** EMP: freeze every OPPONENT drip in a window for 10 game-minutes starting
   *  at the recorded clock (win → game-clock seconds). */
  emp?: Record<string, number>;
  /** Real-time swaps on this side's own slots. */
  swaps?: Record<string, LiveSwap>;
}
export interface LiveExtrasBySide { home?: LiveExtras; away?: LiveExtras; }

const EMP_SECONDS = 600;
export const BYE_STEAL_CAP = 25; // flat-score ceiling — see LiveExtras.byeSteal

// Armed flat-award buffs (mirrors buildMatchup's award()): scans a side's fielded
// players for a trigger and returns the payout, credited to the triggering slot.
function awardFor(buffs: Set<string>, picks: LivePick[], week: number): { pick: LivePick; pts: number }[] {
  const out: { pick: LivePick; pts: number }[] = [];
  const hit = (id: string, pts: number, test: (p: Player) => boolean) => {
    if (!buffs.has(id)) return;
    const pk = picks.find((x) => test(x.player));
    if (pk) out.push({ pick: pk, pts });
  };
  hit('trick-play', 50, (p) => p.pos !== 'QB' && threwTrickTd(p.id, week));
  hit('pick-six', 25, (p) => p.pos === 'DEF' && hadDefTd(p, week));
  hit('hail-mary', 15, (p) => p.pos === 'QB' && hadLongPassTd(p, week));
  return out;
}

/** Resolve a full H2H week from each side's sealed picks (slug-keyed). Picks are
 *  paired by (window, slot). The week's plays must already be injected into the
 *  engine (loadRealWeek / injectWeek) so resolveSlot reads each player's PBP.
 *  `extras` carries each side's applied targeted power-ups (swaps / EMP /
 *  Double-or-Nothing / Bye Steal) — the live counterpart of buildMatchup's. */
export function resolveLiveMatchup(homePicks: LivePick[], awayPicks: LivePick[], week: number, buffs: LiveBuffs = {}, extras: LiveExtrasBySide = {}): LiveResult {
  // COMBO DRIP is ONE-FOR-ONE: one combodrip slot per unlock PURCHASED (buy
  // two, field two — the coin economy limits the stack, not a hard cap).
  // Picks beyond the purchased quantity downgrade to the position's standard
  // drip. Enforced here so every surface (worker, admin force-resolve,
  // playtester, the hindsight adversary) agrees; the DB trigger + apply RPCs
  // (migrations 0061/0062) reject the excess at write time.
  const capCombo = (picks: LivePick[], qty: number): LivePick[] => {
    let used = 0;
    return picks.map((p) => {
      if (p.metricId !== 'combodrip') return p;
      if (used < qty) { used++; return p; }
      return { ...p, metricId: p.player.pos === 'RB' ? 'rush' : 'recyd' };
    });
  };
  homePicks = capCombo(homePicks, buffs.homeComboQty ?? 1);
  awayPicks = capCombo(awayPicks, buffs.awayComboQty ?? 1);
  // Same rule for live swaps INTO combodrip: sealed combodrip slots plus swap
  // targets must stay within the purchased quantity (re-picking the combo
  // slot's own metric doesn't count against it).
  const capSwapCombo = (x: LiveExtras | undefined, picks: LivePick[], qty: number) => {
    if (!x?.swaps) return;
    let have = picks.filter((p) => p.metricId === 'combodrip').length;
    for (const [k, s] of Object.entries(x.swaps)) {
      if (s.toMetricId !== 'combodrip') continue;
      const selfIsCombo = picks.some((p) => p.metricId === 'combodrip' && `${p.win}|${p.slot}` === k);
      if (selfIsCombo) continue; // no net change
      if (have < qty) { have++; continue; }
      delete x.swaps[k].toMetricId; // keep any player swap; drop the over-quantity metric change
    }
  };
  capSwapCombo(extras.home, homePicks, buffs.homeComboQty ?? 1);
  capSwapCombo(extras.away, awayPicks, buffs.awayComboQty ?? 1);
  const reg = REAL_WEEKS.has(week) ? 3600 : 3300;
  // Drip AMPLIFIERS are capacity-limited (1 + Second Amp + Third Amp) — cap
  // authoritatively here so every surface agrees; the arm RPC and clients
  // reject the excess at write time (migration 0063).
  const homeBuffs = capAmplifiers(buffs.homeBuffs ?? new Set<string>());
  const awayBuffs = capAmplifiers(buffs.awayBuffs ?? new Set<string>());
  const hx = extras.home ?? {};
  const ax = extras.away ?? {};
  const key = (p: { win: string; slot: string }) => `${p.win}|${p.slot}`;
  const homeBy = new Map(homePicks.map((p) => [key(p), p]));
  const awayBy = new Map(awayPicks.map((p) => [key(p), p]));

  const slots: SlotRes[] = [];
  // Lineup-wide aggregates for K banker and DEF suppress.
  let homeTds = 0, awayTds = 0, homeBankerXp = 0, awayBankerXp = 0;
  let homeSuppress = 0, awaySuppress = 0;
  // Windows are whatever the sealed picks carry — the client derives them per week
  // from the real slate (a normal week's five, or more when the schedule splits),
  // so we resolve every distinct window id present rather than a fixed five.
  const winIds: string[] = [];
  const seenWin = new Set<string>();
  for (const p of [...homePicks, ...awayPicks]) if (!seenWin.has(p.win)) { seenWin.add(p.win); winIds.push(p.win); }
  // A Bye Steal can target a slot in a window neither side otherwise fielded.
  for (const bs of [hx.byeSteal, ax.byeSteal]) if (bs && !seenWin.has(bs.win)) { seenWin.add(bs.win); winIds.push(bs.win); }
  for (const wid of winIds) {
    const homeIns: SlotInput[] = homePicks.filter((p) => p.win === wid).map((p) => ({ player: p.player, metricId: p.metricId }));
    const awayIns: SlotInput[] = awayPicks.filter((p) => p.win === wid).map((p) => ({ player: p.player, metricId: p.metricId }));
    // Field General builds its multiplier from every filled slot on its side.
    // Overtime carries the multiplier past regulation; fg-stack stacks twin Generals.
    const homeMult = windowFgMult(homeIns, week, { reg, carryOT: homeBuffs.has('overtime'), stack: homeBuffs.has('fg-stack') });
    const awayMult = windowFgMult(awayIns, week, { reg, carryOT: awayBuffs.has('overtime'), stack: awayBuffs.has('fg-stack') });
    // TE-TD 8-PT NUKE clocks: a side's TE TDs knock the OPPONENT's drips.
    const homeTeTd = teTdNukeClocks(homeIns, week).map((n) => n.c);
    const awayTeTd = teTdNukeClocks(awayIns, week).map((n) => n.c);
    // SUPPRESS threshold: a DEF/suppress DST forgoes its own earn score and
    // spends it as the kill-bar. With more than one per side, the highest wins.
    for (const p of homeIns) if (p.player.pos === 'DEF' && p.metricId === 'suppress') homeSuppress = Math.max(homeSuppress, defEarnScore(p.player, week));
    for (const p of awayIns) if (p.player.pos === 'DEF' && p.metricId === 'suppress') awaySuppress = Math.max(awaySuppress, defEarnScore(p.player, week));

    const idxs = new Set<string>();
    for (const p of homePicks) if (p.win === wid) idxs.add(p.slot);
    for (const p of awayPicks) if (p.win === wid) idxs.add(p.slot);
    if (hx.byeSteal?.win === wid) idxs.add(hx.byeSteal.slot);
    if (ax.byeSteal?.win === wid) idxs.add(ax.byeSteal.slot);
    // EMP: a side's freeze on this window suppresses the OPPONENT's drips for
    // 10 game-minutes from the recorded clock (mirrors buildMatchup's extras.emp).
    const homeEmpAt = hx.emp?.[wid];  // home froze AWAY
    const awayEmpAt = ax.emp?.[wid];  // away froze HOME
    const slotOpts = {
      youMult: homeMult, theirMult: awayMult,
      youDripNukeClocks: awayTeTd, theirDripNukeClocks: homeTeTd,
      youBuffs: homeBuffs, theirBuffs: awayBuffs,
      youEmpFreeze: awayEmpAt != null ? [awayEmpAt, awayEmpAt + EMP_SECONDS] as [number, number] : undefined,
      theirEmpFreeze: homeEmpAt != null ? [homeEmpAt, homeEmpAt + EMP_SECONDS] as [number, number] : undefined,
    };
    for (const slot of idxs) {
      const hp = homeBy.get(`${wid}|${slot}`);
      const ap = awayBy.get(`${wid}|${slot}`);
      const you: SlotInput = hp ? { player: hp.player, metricId: hp.metricId } : { player: EMPTY_PLAYER, metricId: 'none' };
      const them: SlotInput = ap ? { player: ap.player, metricId: ap.metricId } : { player: EMPTY_PLAYER, metricId: 'none' };
      const label = `${hp?.player.team || 'BYE'} · ${ap?.player.team || 'BYE'}`;
      const res = resolveSlot(you, them, week, label, slotOpts);
      let homeF = res.youFinal, awayF = res.theirFinal;
      let events = res.events;
      let homeTd = res.youTds, awayTd = res.theirTds, homeXp = res.youBankerXp, awayXp = res.theirBankerXp;

      // Real-time swaps (Metric/Player Swap, Mulligan): keep the pre-cut banked
      // points from the ORIGINAL config, add only the new config's post-cut
      // gains — buildMatchup's split, applied per side. Each side's split runs
      // against the opponent's ORIGINAL config (when both sides swap the same
      // slot — vanishingly rare — each final comes from its own side's split).
      const hSwap = hx.swaps?.[`${wid}|${slot}`];
      if (hSwap && hp) {
        const newYou: SlotInput = { player: hSwap.toPlayer ?? hp.player, metricId: hSwap.toMetricId ?? hp.metricId };
        const sres = resolveSlot(newYou, them, week, label, slotOpts);
        const C = hSwap.atRt != null ? clockAtRealTime(hp.player, week, hSwap.atRt, hp.metricId) : hSwap.atClock;
        const base = banksAtClock(res.events, C);
        const after = banksAtClock(sres.events, C);
        homeF = Math.max(0, round(base.you + Math.max(0, sres.youFinal - after.you)));
        awayF = Math.max(0, round(base.their + (sres.theirFinal - after.their)));
        events = [...res.events.filter((e) => e.clock < C), ...sres.events.filter((e) => e.clock >= C)];
        homeTd = sres.youTds; homeXp = sres.youBankerXp;
      }
      const aSwap = ax.swaps?.[`${wid}|${slot}`];
      if (aSwap && ap) {
        const newThem: SlotInput = { player: aSwap.toPlayer ?? ap.player, metricId: aSwap.toMetricId ?? ap.metricId };
        const sres = resolveSlot(you, newThem, week, label, slotOpts);
        const C = aSwap.atRt != null ? clockAtRealTime(ap.player, week, aSwap.atRt, ap.metricId) : aSwap.atClock;
        const base = banksAtClock(res.events, C);
        const after = banksAtClock(sres.events, C);
        awayF = Math.max(0, round(base.their + Math.max(0, sres.theirFinal - after.their)));
        if (!hSwap) {
          homeF = Math.max(0, round(base.you + (sres.youFinal - after.you)));
          events = [...res.events.filter((e) => e.clock < C), ...sres.events.filter((e) => e.clock >= C)];
        }
        awayTd = sres.theirTds; awayXp = sres.theirBankerXp;
      }

      // A suppress DST banks 0 itself — its points are spent as the threshold.
      if (hp?.player.pos === 'DEF' && hp.metricId === 'suppress') homeF = 0;
      if (ap?.player.pos === 'DEF' && ap.metricId === 'suppress') awayF = 0;

      // Bye Steal: an EMPTY side of this slot fills with a bye player for a flat
      // clamped score (no live game — the opponent's side, resolved solo above,
      // is unchanged, and backups now see this side as fielded).
      let homeP = hp?.player ?? null, awayP = ap?.player ?? null;
      let homeMetric = hp?.metricId ?? null, awayMetric = ap?.metricId ?? null;
      if (!hp && hx.byeSteal && hx.byeSteal.win === wid && hx.byeSteal.slot === slot) {
        homeP = hx.byeSteal.player; homeMetric = 'bye';
        homeF = round(Math.max(0, Math.min(BYE_STEAL_CAP, hx.byeSteal.pts)));
      }
      if (!ap && ax.byeSteal && ax.byeSteal.win === wid && ax.byeSteal.slot === slot) {
        awayP = ax.byeSteal.player; awayMetric = 'bye';
        awayF = round(Math.max(0, Math.min(BYE_STEAL_CAP, ax.byeSteal.pts)));
      }

      slots.push({ win: wid, slot, homeP, awayP, homeMetric, awayMetric, home: homeF, away: awayF, events });
      homeTds += homeTd; awayTds += awayTd;
      homeBankerXp += homeXp; awayBankerXp += awayXp;
    }
  }

  applyBackups(slots, 'home');
  applyBackups(slots, 'away');

  // DEF SUPPRESS (HALVING): apply after backups so a subbed-in starter score is
  // the one tested. Each side's threshold halves every OPPOSING slot (any
  // window) that scored above 0 and at or below it.
  if (homeSuppress > 0 || awaySuppress > 0) {
    for (const s of slots) {
      if (awaySuppress > 0 && s.home > 0 && s.home <= awaySuppress) s.home = round(s.home * 0.5);
      if (homeSuppress > 0 && s.away > 0 && s.away <= homeSuppress) s.away = round(s.away * 0.5);
    }
  }

  // K BANKER (XP BONUS): bake the +XP·TDs into the banker K's window so the
  // grand total stays the sum of per-window states. If a side has multiple
  // banker Ks, the first one's window carries the bonus.
  const bonusSlot = (picks: LivePick[]): SlotRes | undefined => {
    const banker = picks.find((p) => p.player.pos === 'K' && p.metricId === 'banker');
    if (!banker) return undefined;
    return slots.find((s) => s.win === banker.win && s.slot === banker.slot);
  };
  const homeBonus = homeBankerXp * homeTds;
  const awayBonus = awayBankerXp * awayTds;
  if (homeBonus > 0) { const sl = bonusSlot(homePicks); if (sl) sl.home = round(sl.home + homeBonus); }
  if (awayBonus > 0) { const sl = bonusSlot(awayPicks); if (sl) sl.away = round(sl.away + awayBonus); }

  // Double or Nothing: the staked slot (both sides fielded) scores ×2 if it wins
  // its head-to-head, 0 if it loses — on the post-backup/suppress score, before
  // flat awards (mirrors buildMatchup, which stakes the slot's own final).
  const donFor = (x: LiveExtras, side: 'home' | 'away') => {
    if (!x.don) return;
    const s = slots.find((t) => t.win === x.don!.win && t.slot === x.don!.slot);
    if (!s || !s.homeP || !s.awayP) return; // unopposed/empty slots can't be staked
    if (side === 'home') { const won = s.home > s.away; s.home = won ? round(s.home * 2) : 0; }
    else { const won = s.away > s.home; s.away = won ? round(s.away * 2) : 0; }
  };
  donFor(hx, 'home');
  donFor(ax, 'away');

  // Trick Play / Pick Six / Hail Mary: armed flat awards, credited to the
  // triggering player's slot so per-window sums still equal the totals.
  for (const a of awardFor(homeBuffs, homePicks, week)) {
    const s = slots.find((t) => t.win === a.pick.win && t.slot === a.pick.slot);
    if (s) s.home = round(s.home + a.pts);
  }
  for (const a of awardFor(awayBuffs, awayPicks, week)) {
    const s = slots.find((t) => t.win === a.pick.win && t.slot === a.pick.slot);
    if (s) s.away = round(s.away + a.pts);
  }

  // Per-side event flags for the card board. Event `side` is 'you' = home /
  // 'their' = away (the resolveSlot pairing above). Attribution differs by shape:
  //   • hot — the engine stamps 🔥 HOT into the achieving side's own streak/drip
  //     badge text, so the event side IS the hot side.
  //   • nuked — TE-TD drip nukes are standalone events attributed to the VICTIM
  //     (delta 0, not sig); TD/erasure nukes ride the ATTACKER's play event
  //     (sig: true), so the victim is the opposite side.
  const flagsFor = (s: SlotRes, side: 'home' | 'away') => {
    const me = side === 'home' ? 'you' : 'their';
    let hot = false, nuked = false;
    for (const e of s.events) {
      if (e.side === me && (e.effect?.type === 'streak' || e.drip) && (e.effect?.text ?? e.play).includes('HOT')) hot = true;
      if (e.effect?.type === 'nuke' && (e.sig ? e.side !== me : e.side === me)) nuked = true;
    }
    return { hot: hot || undefined, nuked: nuked || undefined };
  };

  const byWin: Record<string, { home: number; away: number }> = {};
  let home = 0, away = 0;
  const slotScores: SlotScore[] = [];
  for (const s of slots) {
    const b = (byWin[s.win] ||= { home: 0, away: 0 });
    b.home += s.home; b.away += s.away;
    home += s.home; away += s.away;
    if (s.homeP) slotScores.push({ win: s.win, slot: s.slot, side: 'home', slug: s.homeP.id, metric: s.homeMetric, score: s.home, ...flagsFor(s, 'home') });
    if (s.awayP) slotScores.push({ win: s.win, slot: s.slot, side: 'away', slug: s.awayP.id, metric: s.awayMetric, score: s.away, ...flagsFor(s, 'away') });
  }
  const states = Object.entries(byWin).map(([window, v]) => ({ window, home: round(v.home), away: round(v.away) }));
  return { states, slots: slotScores, home: round(home), away: round(away), coin: { home: coinFor(slots, 'home'), away: coinFor(slots, 'away') } };
}
