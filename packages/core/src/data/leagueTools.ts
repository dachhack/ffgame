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
// Pure folds + a loader; both clients draw them.
import type { WidgetSnapshot, WidgetFix } from './widgetFeed';
import { leagueTrades, tradeSignals, matchupTeams, leaguePoolNames, type TradeRow, type TradeSignalRow } from './liveApi';

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
