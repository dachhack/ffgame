// DEVY SHARES (0387) — the pure half, for both hosts.
//
// A shares league gives every team 100 shares to put on college players, at
// most 20 on one. The team whose stake reached 20 FIRST holds the player's
// right; failing that, the ONLY team holding him does, if it holds 5 or more.
// The right is a reservation in the rookie draft once he turns pro. The
// database decides all of it (devy_share_rights); this only words it.
import type { DevySharePlayer, DevySharesState } from './liveApi';

export const DEVY_SHARE_RULES = { budget: 100, max: 20, floor: 5, cash_cap: 200, payout_cap: 3, max_spend: 60, min_spend: 15, refund: 0.5 } as const;

/** 0388: a team's cash and what its stakes would pay today. */
export function teamBook(st: DevySharesState | null | undefined, rosterId: number | null | undefined): { cash: number; value: number; shares: number } {
  const k = rosterId == null ? '' : String(rosterId);
  return {
    cash: rosterId == null ? 0 : Number(st?.cash?.[k] ?? st?.rules?.budget ?? DEVY_SHARE_RULES.budget),
    value: rosterId == null ? 0 : Number(st?.value?.[k] ?? 0),
    shares: rosterId == null ? 0 : Number(st?.used?.[k] ?? 0),
  };
}

/** "paid 20 · worth 40 (+20)" — a stake's cost basis against today. */
export function stakeLine(cost: number | undefined, value: number | undefined): string {
  const c = Number(cost ?? 0), v = Number(value ?? 0);
  const d = Math.round((v - c) * 100) / 100;
  return `paid ${fmtPts(c)} · worth ${fmtPts(v)} (${d >= 0 ? '+' : ''}${fmtPts(d)})`;
}

/** Points, without trailing zeros: 20, 12.5. */
export const fmtPts = (n: number): string => String(Math.round(n * 100) / 100);

/** Shares a team has placed, and what's left of its budget. */
export function sharesUsed(st: DevySharesState | null | undefined, rosterId: number | null | undefined): { used: number; free: number; budget: number } {
  const budget = st?.rules?.budget ?? DEVY_SHARE_RULES.budget;
  const used = rosterId == null ? 0 : (st?.used?.[String(rosterId)] ?? 0);
  return { used, free: Math.max(0, budget - used), budget };
}

/** A team's own stake in a player (0 if none). */
export const myStake = (p: DevySharePlayer, rosterId: number | null | undefined): number =>
  (rosterId == null ? 0 : p.holders.find((h) => h.roster_id === rosterId)?.shares ?? 0);

/** Where a team stands on a player, in a few words (0396: a stake maxes at
 *  20 shares or 60 points spent; a sole right needs 5+ shares AND 15+ spent,
 *  and only a stake like that can break someone else's). */
export function rightLine(p: DevySharePlayer, rosterId: number | null | undefined, floor: number = DEVY_SHARE_RULES.floor, max: number = DEVY_SHARE_RULES.max,
  minSpend: number = DEVY_SHARE_RULES.min_spend): string {
  const mineH = rosterId == null ? undefined : p.holders.find((h) => h.roster_id === rosterId);
  const holder = p.right ? p.holders.find((h) => h.roster_id === p.right!.roster_id) : null;
  if (p.right && p.right.roster_id === rosterId) return p.right.via === 'max' ? '★ YOUR RIGHT — first to max' : '★ YOUR RIGHT — the only qualified team';
  if (p.right && holder) return p.right.via === 'max' ? `${holder.team} holds his right (first to max)` : `${holder.team} holds his right (the only qualified team)`;
  const qualified = p.holders.filter((h) => h.qualified ?? (h.shares >= floor && Number(h.cost ?? 0) >= minSpend));
  if (mineH && !qualified.some((h) => h.roster_id === rosterId)) {
    const needShares = Math.max(0, floor - mineH.shares);
    const needPts = Math.max(0, minSpend - Number(mineH.cost ?? 0));
    return `not qualified yet — ${[needShares ? `${needShares} more share${needShares === 1 ? '' : 's'}` : '', needPts ? `${fmtPts(needPts)} more points in` : ''].filter(Boolean).join(' and ')}`;
  }
  if (qualified.length > 1) return `${qualified.length} qualified teams — first to max (${max} shares or 60 points) holds his right`;
  return 'nobody holds his right yet';
}

/** How many shares a buy may add before the stake maxes: 20 shares, or 60
 *  points spent (every share but the last must start under 60). */
export function maxBuy(cur: number, cost: number, price: number, max: number = DEVY_SHARE_RULES.max, maxSpend: number = DEVY_SHARE_RULES.max_spend): number {
  if (cur >= max || cost >= maxSpend || !(price > 0)) return 0;
  return Math.max(0, Math.min(max - cur, Math.ceil((maxSpend - cost) / price)));
}

/** "Locked since Jan 15 — until the rookie draft is done" / "Locks Jan 15". */
export function lockLine(st: DevySharesState | null | undefined): string {
  if (!st?.on) return '';
  if (st.locked) return 'Locked since Jan 15 until the rookie draft is done.';
  return 'You can move shares until Jan 15. From then until the rookie draft, they are locked.';
}
