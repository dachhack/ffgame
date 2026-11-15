// WATCHING A MATCHUP YOU ARE NOT IN (v0.739.0). Founder: "I think we need a
// way for players to browse to other matchups happening in the league this
// week … Full board after kickoff."
//
// A league-mate reads the worker's published window rows (matchup_state, open
// to the league since 0532) and nothing else — no sealed pick, no applied
// power-up. Those rows exist only for a window that has kicked off, so this
// module cannot show a lineup that is still sealed: a window with no row is
// simply not in what it returns, and the host draws it as sealed.
//
// Pure, so the phone and the web shape the same board from the same rows and
// scripts/check-matchup-watch.mjs can pin it.
import { PHANTOM_SLOT_METRICS, srvSidePicks, srvSlotRow, type SrvSlotScore, type SrvWindowScore } from '../engine/liveScore';

/** One side of one spot, as published. `phantom` is a Ghost or a Bye Steal:
 *  it scores, and it is not a player anybody fielded. */
export interface WatchCell { slug: string | null; metric: string | null; score: number; phantom: 'ghost' | 'bye' | null; hot?: boolean; nuked?: boolean }
export interface WatchSpot { slot: string; home: WatchCell | null; away: WatchCell | null }
export interface WatchWindow { win: string; home: number; away: number; spots: WatchSpot[] }
export interface WatchBoard { home: number; away: number; windows: WatchWindow[] }

const r1 = (n: number) => Math.round(n * 10) / 10;
type Row = SrvSlotScore & { hot?: boolean; nuked?: boolean };

function cellFor(rows: Row[] | null | undefined, side: 'home' | 'away', slot: string, picks: { roster_slot: string; player_slug: string; metric_id: string | null }[]): WatchCell | null {
  const ph = (rows ?? []).find((r) => r.side === side && r.slot != null && String(r.slot) === slot && !!r.metric && PHANTOM_SLOT_METRICS.has(r.metric));
  if (ph) return { slug: ph.slug ?? null, metric: null, score: r1(Number(ph.score) || 0), phantom: ph.metric === 'ghost' ? 'ghost' : 'bye' };
  const p = picks.find((x) => x.roster_slot === slot);
  if (!p) return null;
  const row = srvSlotRow(rows as Row[] | undefined, side, slot, p.player_slug);
  return { slug: p.player_slug, metric: p.metric_id, score: r1(Number(row?.score) || 0), phantom: null, hot: !!row?.hot, nuked: !!row?.nuked };
}

/** The board a league-mate sees: every PUBLISHED window in the order given
 *  (the week's own windows; an unknown one sorts last), spots paired by
 *  roster slot — the key the engine scores by — and the headline totals, which
 *  are the sum of the window rows exactly as the players' own boards sum them. */
export function watchBoard(states: SrvWindowScore[] | null | undefined, order: readonly string[] = []): WatchBoard {
  const rank = (w: string) => { const i = order.indexOf(w); return i === -1 ? 999 : i; };
  const wins = [...(states ?? [])].sort((a, b) => rank(a.game_window) - rank(b.game_window) || a.game_window.localeCompare(b.game_window));
  let home = 0, away = 0;
  const windows: WatchWindow[] = wins.map((s) => {
    home += Number(s.home_score) || 0; away += Number(s.away_score) || 0;
    const rows = (s.slot_scores ?? []) as Row[];
    const hp = srvSidePicks(s.game_window, rows, 'home');
    const ap = srvSidePicks(s.game_window, rows, 'away');
    const phantomSlots = rows.filter((r) => !!r.metric && PHANTOM_SLOT_METRICS.has(r.metric) && r.slot != null).map((r) => String(r.slot));
    const slots = [...new Set([...hp, ...ap].map((p) => p.roster_slot).concat(phantomSlots))]
      .sort((a, b) => (Number(a) - Number(b)) || a.localeCompare(b));
    return {
      win: s.game_window, home: r1(Number(s.home_score) || 0), away: r1(Number(s.away_score) || 0),
      spots: slots.map((slot) => ({ slot, home: cellFor(rows, 'home', slot, hp), away: cellFor(rows, 'away', slot, ap) })),
    };
  });
  return { home: r1(home), away: r1(away), windows };
}

/** The windows of the week that have published nothing — still sealed (or
 *  never played). The host lists them so the board does not look short. */
export function watchSealedWindows(states: SrvWindowScore[] | null | undefined, order: readonly string[]): string[] {
  const have = new Set((states ?? []).map((s) => s.game_window));
  return order.filter((w) => !have.has(w));
}
