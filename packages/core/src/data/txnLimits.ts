// TRANSACTION LIMITS (0358), the manager's side: one line saying what is left,
// the same words on web and app. The server counts (league_txn_limits); this
// only says it.
import type { TxnLimits } from './liveApi';

const left = (max: number, used: number) => Math.max(0, max - used);

/** When the week turns, in the league's clock (ET), from week_start. */
export function txnResetLabel(weekStart: string | null | undefined): string | null {
  if (!weekStart) return null;
  const t = Date.parse(weekStart);
  if (!Number.isFinite(t)) return null;
  return new Date(t + 7 * 86_400_000).toLocaleString('en-US', {
    weekday: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York',
  }) + ' ET';
}

export interface TxnLimitSummary {
  /** The line to show, or null when the league sets no limits. */
  text: string | null;
  /** No adds left (this week or this season): pickups will be refused. */
  addsOut: boolean;
  /** No trades left this season. */
  tradesOut: boolean;
}

export function txnLimitSummary(l: TxnLimits | null | undefined): TxnLimitSummary {
  if (!l || !l.ok) return { text: null, addsOut: false, tradesOut: false };
  const u = l.used ?? { week: 0, season: 0, trades: 0 };
  const parts: string[] = [];
  let addsOut = false, tradesOut = false;
  if (l.max_adds_week != null) {
    const n = left(l.max_adds_week, u.week);
    if (n === 0) addsOut = true;
    const reset = txnResetLabel(l.week_start);
    parts.push(`${n} of ${l.max_adds_week} add${l.max_adds_week === 1 ? '' : 's'} left this week${reset ? ` (resets ${reset})` : ''}`);
  }
  if (l.max_adds_season != null) {
    const n = left(l.max_adds_season, u.season);
    if (n === 0) addsOut = true;
    parts.push(`${n} of ${l.max_adds_season} left this season`);
  }
  if (l.max_trades_season != null) {
    const n = left(l.max_trades_season, u.trades);
    if (n === 0) tradesOut = true;
    parts.push(`${n} of ${l.max_trades_season} trade${l.max_trades_season === 1 ? '' : 's'} left`);
  }
  return { text: parts.length ? parts.join(' · ') : null, addsOut, tradesOut };
}
