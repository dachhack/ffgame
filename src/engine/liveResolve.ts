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
//     such backup subs for the side's lowest beatable starter, and with 2+
//     unopposed the rest bank half-credit.
//   • Drip-coin economy — weekly stipend + unopposed bounty + per-event-of-note
//     coin, returned per side. (No DB sink yet; surfaced for a future column.)
//
// DEF suppress / TE-TD cross-window nukes / K banker remain simplified here —
// they need a wider rework and aren't yet exercised by the pilot.
import type { Player, PbpEvent, Pos } from '../types';
import { WINDOWS, metricById } from '../data/metrics';
import { REAL_WEEKS } from '../data/realPbp';
import { resolveSlot, windowFgMult, EMPTY_PLAYER, type SlotInput } from './sim';

export interface LivePick { win: string; slot: string; player: Player; metricId: string; }
export interface LiveWindowScore { window: string; home: number; away: number; }
export interface LiveResult {
  states: LiveWindowScore[];          // per-window scores, post-backup (sum to the totals)
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
 *  beatable starter, and with 2+ unopposed the rest bank half their score. */
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
  // With 2+ unopposed slots, every backup that didn't sub in still banks half.
  if (backups.length >= 2) for (const b of backups) if (!used.has(b)) setF(b, round(score.get(b)! * 0.5));
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

/** Resolve a full H2H week from each side's sealed picks (slug-keyed). Picks are
 *  paired by (window, slot). The week's plays must already be injected into the
 *  engine (loadRealWeek / injectWeek) so resolveSlot reads each player's PBP. */
export function resolveLiveMatchup(homePicks: LivePick[], awayPicks: LivePick[], week: number): LiveResult {
  const reg = REAL_WEEKS.has(week) ? 3600 : 3300;
  const key = (p: { win: string; slot: string }) => `${p.win}|${p.slot}`;
  const homeBy = new Map(homePicks.map((p) => [key(p), p]));
  const awayBy = new Map(awayPicks.map((p) => [key(p), p]));

  const slots: SlotRes[] = [];
  for (const w of WINDOWS) {
    const homeIns: SlotInput[] = homePicks.filter((p) => p.win === w.id).map((p) => ({ player: p.player, metricId: p.metricId }));
    const awayIns: SlotInput[] = awayPicks.filter((p) => p.win === w.id).map((p) => ({ player: p.player, metricId: p.metricId }));
    // Field General builds its multiplier from every filled slot on its side.
    const homeMult = windowFgMult(homeIns, week, { reg });
    const awayMult = windowFgMult(awayIns, week, { reg });

    const idxs = new Set<string>();
    for (const p of homePicks) if (p.win === w.id) idxs.add(p.slot);
    for (const p of awayPicks) if (p.win === w.id) idxs.add(p.slot);
    for (const slot of idxs) {
      const hp = homeBy.get(`${w.id}|${slot}`);
      const ap = awayBy.get(`${w.id}|${slot}`);
      const you: SlotInput = hp ? { player: hp.player, metricId: hp.metricId } : { player: EMPTY_PLAYER, metricId: 'none' };
      const them: SlotInput = ap ? { player: ap.player, metricId: ap.metricId } : { player: EMPTY_PLAYER, metricId: 'none' };
      const label = `${hp?.player.team || 'BYE'} · ${ap?.player.team || 'BYE'}`;
      const res = resolveSlot(you, them, week, label, { youMult: homeMult, theirMult: awayMult });
      slots.push({
        win: w.id, slot, homeP: hp?.player ?? null, awayP: ap?.player ?? null,
        homeMetric: hp?.metricId ?? null, awayMetric: ap?.metricId ?? null,
        home: res.youFinal, away: res.theirFinal, events: res.events,
      });
    }
  }

  applyBackups(slots, 'home');
  applyBackups(slots, 'away');

  const byWin: Record<string, { home: number; away: number }> = {};
  let home = 0, away = 0;
  for (const s of slots) {
    const b = (byWin[s.win] ||= { home: 0, away: 0 });
    b.home += s.home; b.away += s.away;
    home += s.home; away += s.away;
  }
  const states = Object.entries(byWin).map(([window, v]) => ({ window, home: round(v.home), away: round(v.away) }));
  return { states, home: round(home), away: round(away), coin: { home: coinFor(slots, 'home'), away: coinFor(slots, 'away') } };
}
