// THE LEAGUE TOOLS BAR (v0.715.0). Founder: "Right now the league tools bar is
// just heroes and villains. I'd like it to be a scrollable bar of tools for
// players: all fields, heroes and villains, line up suggestions and alerts,
// waiver targets, trade zone, etc."
//
// What the tools read, across every league you play in:
//   • LINEUP ALERTS — the fixes each league's glance already carries (an empty
//     spot, an injured or bye starter, a better man on the bench, a drip slot
//     with no metric). Folded here; no new read.
//   • TRADE ZONE — offers waiting on you and on them, players other teams want
//     from you, and what is on the trade block. One league_trades and one
//     trade_signals read per native league, names from its pool.
//   • WAIVER TARGETS (v0.716.0) — the AI seats' own wire planner
//     (seatWirePlan), run for YOUR seat: who on the wire would help this
//     week's lineup, and whom he'd replace. Computed with each league's glance
//     (widgetSnapshot's `wire`), under the league's own scoring.
// Pure folds + a loader; both clients draw them.
import type { WidgetSnapshot, WidgetFix } from './widgetFeed';
import { leagueTrades, tradeSignals, matchupTeams, leaguePoolNames, type TradeRow, type TradeSignalRow, type LeaguePoolPlayer, type NativeRosterRow } from './liveApi';
import { seatWirePlan, shortlistWire, type WirePlayer, type WireClaim } from '../engine/seatWaivers';
import { slateAwareProj, type ClassicSlotDef, type SpotPlayer } from '../engine/classic';
import { projectedPoints } from '../engine/projScoring';
import { playRisk } from '../engine/golfFloor';
import { normTeam } from './teamCodes';

// ── LINEUP ALERTS ─────────────────────────────────────────────────────────────
export interface LineupAlert { leagueId: string; rosterId: number; leagueName: string; weekLabel: string; fixes: WidgetFix[] }

/** Every league with something to fix, worst first (most fixes), leagues with
 *  none left out. A finished week has nothing to fix. */
export function lineupAlerts(snaps: (WidgetSnapshot | null | undefined)[]): LineupAlert[] {
  const out: LineupAlert[] = [];
  for (const s of snaps) {
    if (!s || s.phase === 'final' || !s.fixes?.length) continue;
    out.push({ leagueId: s.leagueId, rosterId: s.rosterId, leagueName: s.leagueName, weekLabel: s.weekLabel, fixes: s.fixes });
  }
  return out.sort((a, b) => b.fixes.length - a.fixes.length || a.leagueName.localeCompare(b.leagueName));
}
export const lineupAlertCount = (snaps: (WidgetSnapshot | null | undefined)[]): number =>
  lineupAlerts(snaps).reduce((n, a) => n + a.fixes.length, 0);

// ── TRADE ZONE ────────────────────────────────────────────────────────────────
export type TradeZoneKind = 'offer_in' | 'offer_out' | 'want' | 'block';
export interface TradeZoneItem {
  kind: TradeZoneKind; leagueId: string; leagueName: string; rosterId: number;
  /** The other team. */
  team: string;
  /** offer: what you'd get / give; want: your player they want; block: their player. */
  get: string[]; give: string[];
  at: string;
}
export const TRADE_ZONE_ORDER: TradeZoneKind[] = ['offer_in', 'want', 'offer_out', 'block'];
export const TRADE_ZONE_TITLE: Record<TradeZoneKind, string> = {
  offer_in: 'WAITING ON YOU', want: 'THEY WANT YOUR', offer_out: 'WAITING ON THEM', block: 'ON THE BLOCK',
};

/** One league's zone from its trades and signals. Pure. `name` and `team`
 *  resolve a slug and a roster to words; anything missing reads as itself. */
export function tradeZoneOf(
  league: { id: string; name: string; rosterId: number },
  trades: TradeRow[], signals: TradeSignalRow[],
  name: (slug: string) => string, team: (rosterId: number) => string,
): TradeZoneItem[] {
  const me = league.rosterId;
  const base = { leagueId: league.id, leagueName: league.name, rosterId: me };
  const out: TradeZoneItem[] = [];
  for (const t of trades) {
    if (t.status !== 'pending' || t.legs?.length) continue;   // a multi-team deal lives in the league's trade center
    if (t.to_roster === me) out.push({ ...base, kind: 'offer_in', team: team(t.from_roster), get: t.give.map(name), give: t.get.map(name), at: t.created_at });
    else if (t.from_roster === me) out.push({ ...base, kind: 'offer_out', team: team(t.to_roster), get: t.get.map(name), give: t.give.map(name), at: t.created_at });
  }
  for (const s of signals) {
    if (s.kind === 'want' && s.holder_roster === me && s.roster_id !== me) out.push({ ...base, kind: 'want', team: team(s.roster_id), get: [], give: [name(s.slug)], at: s.created_at });
    if (s.kind === 'block' && s.holder_roster !== me) out.push({ ...base, kind: 'block', team: team(s.holder_roster), get: [name(s.slug)], give: [], at: s.created_at });
  }
  return out;
}

/** Sort a zone: the kinds in TRADE_ZONE_ORDER, newest first within each. */
export function sortTradeZone(items: TradeZoneItem[]): TradeZoneItem[] {
  const rank = (k: TradeZoneKind) => TRADE_ZONE_ORDER.indexOf(k);
  return items.slice().sort((a, b) => rank(a.kind) - rank(b.kind) || b.at.localeCompare(a.at));
}
/** What wants an answer from you: offers to you and wants on your players. */
export const tradeZoneCount = (items: TradeZoneItem[]): number => items.filter((i) => i.kind === 'offer_in' || i.kind === 'want').length;

/** Read the zone for the native leagues you play in. A league that fails to
 *  read is left out rather than failing the rest. */
export async function loadTradeZone(leagues: { id: string; name: string; rosterId: number }[]): Promise<TradeZoneItem[]> {
  const per = await Promise.all(leagues.map(async (l) => {
    try {
      const [tr, sg] = await Promise.all([leagueTrades(l.id, 40), tradeSignals(l.id)]);
      const trades = Array.isArray(tr) ? tr : [];
      const signals = Array.isArray(sg) ? sg : [];
      const slugs = new Set<string>(), rosters = new Set<number>();
      for (const t of trades) if (t.status === 'pending' && (t.to_roster === l.rosterId || t.from_roster === l.rosterId)) {
        [...t.give, ...t.get].forEach((x) => slugs.add(x)); rosters.add(t.from_roster); rosters.add(t.to_roster);
      }
      for (const s of signals) { slugs.add(s.slug); rosters.add(s.roster_id); rosters.add(s.holder_roster); }
      if (!slugs.size) return [];
      const [names, teams] = await Promise.all([
        leaguePoolNames(l.id, [...slugs]).catch(() => ({} as Record<string, string>)),
        matchupTeams(l.id, [...rosters]).catch(() => ({} as Record<number, { team_name?: string | null }>)),
      ]);
      return tradeZoneOf(l, trades, signals, (slug) => names[slug] ?? slug, (rid) => (teams as Record<number, { team_name?: string | null }>)[rid]?.team_name || `Team ${rid}`);
    } catch { return []; }
  }));
  return sortTradeZone(per.flat());
}

// ── WAIVER TARGETS ────────────────────────────────────────────────────────────
export interface WireTarget {
  add: string; addName: string; pos: string; team: string | null;
  /** Who he'd replace — null when an open roster place takes him. */
  drop: string | null; dropName: string | null;
  /** Points per week he adds to this week's best lineup. */
  gain: number;
  /** …and to the rest of the season's (0 when the season says nothing). */
  rosGain: number;
  kind: WireClaim['kind'];
  /** Inside his waiver hold: a claim, not an instant add. */
  claim: boolean;
}
export const WIRE_KIND_LABEL: Record<WireClaim['kind'], string> = {
  hole: 'FILLS A HOLE', upgrade: 'UPGRADE', depth: 'DEPTH', bench: 'BETTER STASH',
};
export const WIRE_TARGETS_MAX = 3;

/** The wire for one seat, the way the AI seats read it (server/src/seatWire.js):
 *  this week's value (byes, Outs and play risk priced), a healthy read that
 *  keeps a Doubtful starter off the drop list, and the season projection
 *  (zero for IR) deciding who may go. Call it with the league's scoring
 *  INSTALLED — the glance does. Pure otherwise. */
export function wireTargetsOf(input: {
  slots: ClassicSlotDef[];
  /** My ACTIVE players (taxi/IR/out are not dropped for an add). */
  roster: { slug: string; full: string; pos: string; team: string | null; exp?: number | null; sleeperId?: string | null }[];
  pool: LeaguePoolPlayer[];
  /** Every seat's rows, all spots. */
  rosters: NativeRosterRow[];
  rosterId: number;
  copies: number;
  injuries: Record<string, string>;
  week: number;
  slate: { home: string; away: string; kickoff?: string | null }[];
  nowMs: number;
  /** Active seats (starters + bench), when the league says; null → every add needs a drop. */
  activeSeats: number | null;
  exp?: Record<string, number>;
  max?: number;
}): WireTarget[] {
  const { slots, roster, pool, rosters, rosterId, injuries, week, slate, nowMs } = input;
  if (!slots.length || !pool.length || !roster.length) return [];
  const copies = Math.max(1, Math.min(4, input.copies || 1));
  const holds = new Map<string, number>();
  const mineAll = new Set<string>();
  for (const r of rosters) {
    holds.set(r.slug, (holds.get(r.slug) ?? 0) + 1);
    if (r.roster_id === rosterId) mineAll.add(r.slug);
  }
  const kicks = new Map<string, number>();
  for (const g of slate) {
    const k = g.kickoff ? Date.parse(g.kickoff) : NaN;
    if (!Number.isFinite(k)) continue;
    kicks.set(normTeam(g.home), k); kicks.set(normTeam(g.away), k);
  }
  const names = new Map<string, string>(pool.map((p) => [p.slug, p.full_name]));
  for (const p of roster) names.set(p.slug, p.full);
  const available: WirePlayer[] = [];
  for (const p of pool) {
    if (mineAll.has(p.slug) || (holds.get(p.slug) ?? 0) >= copies) continue;
    const held = !!p.waived_until && Date.parse(p.waived_until) > nowMs;
    available.push({ id: p.slug, pos: p.pos, team: p.team || null, exp: input.exp?.[p.slug] ?? null, sleeperId: p.sleeper_id ?? null, onWaivers: held, held });
  }
  if (!available.length) return [];
  const mine: SpotPlayer[] = roster.map((p) => ({ id: p.slug, pos: p.pos, team: p.team, exp: p.exp ?? null, sleeperId: p.sleeperId ?? null }));
  const out = (slug: string) => injuries[slug] === 'O' || injuries[slug] === 'IR';
  const weekly = slateAwareProj(week, slate, (slug) => (out(slug) ? true : playRisk(injuries[slug])), { discountRisk: true });
  // A free agent whose game already kicked off can't be seated this week.
  const kicked = (p: SpotPlayer) => { const k = kicks.get(normTeam(p.team ?? '')); return k != null && k <= nowMs; };
  const freeIds = new Set(available.map((p) => p.id));
  const valueOf = (p: SpotPlayer, d?: ClassicSlotDef) => (freeIds.has(p.id) && kicked(p) ? 0 : weekly(p, d));
  const healthyValueOf = slateAwareProj(week, slate, () => false);
  const rosValueOf = (p: SpotPlayer) => (injuries[p.id] === 'IR' ? 0 : projectedPoints({ id: p.id, pos: p.pos ?? '', team: p.team, sleeperId: p.sleeperId ?? null }));
  const candidates = shortlistWire(available, rosValueOf, undefined, { slots, roster: mine });
  const openSeats = input.activeSeats != null ? Math.max(0, input.activeSeats - roster.length) : 0;
  const plan = seatWirePlan(slots, mine, candidates, valueOf, {
    faab: false, budget: 0, openSeats, maxClaims: input.max ?? WIRE_TARGETS_MAX, rosValueOf, healthyValueOf,
  });
  const byId = new Map(available.map((p) => [p.id, p]));
  return plan.map((c) => {
    const a = byId.get(c.add);
    return {
      add: c.add, addName: names.get(c.add) ?? c.add, pos: a?.pos ?? '', team: a?.team ?? null,
      drop: c.drop, dropName: c.drop ? names.get(c.drop) ?? c.drop : null,
      gain: Math.round(c.gain * 10) / 10, rosGain: Math.round(c.rosGain * 10) / 10, kind: c.kind, claim: c.onWaivers,
    };
  });
}

export interface WireTargetLeague { leagueId: string; rosterId: number; leagueName: string; weekLabel: string; targets: WireTarget[] }
/** Every league with a target, the biggest gain first. */
export function wireTargets(snaps: (WidgetSnapshot | null | undefined)[]): WireTargetLeague[] {
  const out: WireTargetLeague[] = [];
  for (const s of snaps) {
    if (!s?.wire?.length) continue;
    out.push({ leagueId: s.leagueId, rosterId: s.rosterId, leagueName: s.leagueName, weekLabel: s.weekLabel, targets: s.wire });
  }
  const top = (l: WireTargetLeague) => Math.max(...l.targets.map((t) => t.gain));
  return out.sort((a, b) => top(b) - top(a) || a.leagueName.localeCompare(b.leagueName));
}
export const wireTargetCount = (snaps: (WidgetSnapshot | null | undefined)[]): number =>
  wireTargets(snaps).reduce((n, l) => n + l.targets.length, 0);
