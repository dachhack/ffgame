// THE PUBLISHED SCORE — one rule for the bar, the card and the headline.
//
// Two hosts render the same live matchup. The app reads the resolver's rows out
// of `matchup_state`; the web re-simulated the week in the browser. Both were
// right about their own inputs and they disagreed on screen, which is what the
// founder saw: a FLAT metric matched (clock-independent once the plays are in)
// and a DRIP metric did not, because a drip's value IS a function of the clock
// and two clocks give two honest answers.
//
// The resolver decides the week, so the resolver's number is the one to show.
// What lives here is the mapping and the precedence — pure, so it can be
// asserted (scripts/check-live-score.mjs) rather than trusted inside a
// component that only runs against a live database.

/** A resolver slot row as `matchup_state.slot_scores` stores it. Structural on
 *  purpose: `liveApi`'s SlotScoreRow satisfies it, without dragging the
 *  Supabase client into the engine. */
export interface SrvSlotScore { side: 'home' | 'away'; slot?: string | number | null; slug?: string | null; score: number }
/** A resolver window row as `matchup_state` stores it. */
export interface SrvWindowScore { game_window: string; home_score: number; away_score: number; slot_scores?: SrvSlotScore[] | null }

/** The serialized per-slot payload: side already read as you/them, plus BOTH
 *  keys the row can be matched on. */
export interface SrvSlotWire { w: 'y' | 't'; k: string; g: string; v: number }

/** Serialize one window's slot rows, mapped to you/them.
 *
 *  A STRING because the web hands this to a memoized `WindowSection` whose
 *  comparator is a key-by-key `Object.is` — a fresh array out of `.filter()`
 *  is never equal to the last one and would re-render every window section on
 *  every poll. A string compares by value, so an unchanged poll is genuinely
 *  unchanged. '' means the server has published nothing for this window, which
 *  is NOT the same as publishing zeros: the caller then keeps its local sim
 *  rather than painting a 0 nobody sent.
 *
 *  Both keys ride along — `k` the roster slot, `g` the slug — because that is
 *  the pair the app's own row lookup matches on, so the two hosts agree about
 *  which card a row belongs to even if slot numbering ever drifts. */
export function encodeSrvSlots(rows: SrvSlotScore[] | null | undefined, youAreHome: boolean): string {
  if (!rows?.length) return '';
  const out: SrvSlotWire[] = rows.map((r) => ({
    w: ((r.side === 'home') === youAreHome ? 'y' : 't') as 'y' | 't',
    k: r.slot == null ? '' : String(r.slot),
    g: r.slug ?? '',
    v: Number(r.score) || 0,
  }));
  return JSON.stringify(out);
}

/** Parse a payload from `encodeSrvSlots` into a lookup keyed BOTH ways:
 *  `y#3` / `t#3` by roster slot and `y@josh-allen` by slug.
 *
 *  Never throws. A malformed payload yields an empty map, and every caller
 *  treats an empty map as "no server row" — i.e. it falls back to the local
 *  sim, which is the same thing it did before any of this existed. */
export function decodeSrvSlots(payload: string | null | undefined): Map<string, number> {
  const out = new Map<string, number>();
  if (!payload) return out;
  let rows: unknown;
  try { rows = JSON.parse(payload); } catch { return out; }
  if (!Array.isArray(rows)) return out;
  for (const raw of rows) {
    const r = raw as Partial<SrvSlotWire>;
    if (r?.w !== 'y' && r?.w !== 't') continue;
    const v = Number(r.v);
    if (!Number.isFinite(v)) continue;
    if (r.k) out.set(`${r.w}#${r.k}`, v);
    if (r.g) out.set(`${r.w}@${r.g}`, v);
  }
  return out;
}

/** One slot's published score for one side, or null when the server has not
 *  published a row for it — an unopposed half, a window that hasn't kicked.
 *  Null and not 0: the caller falls back to its own bank, because a 0 here
 *  would claim the resolver scored the slot at nothing. */
export function srvSlotScore(map: Map<string, number>, side: 'y' | 't', slotIndex: number | string, slug?: string | null): number | null {
  const bySlot = map.get(`${side}#${slotIndex}`);
  if (bySlot != null) return bySlot;
  if (slug) { const bySlug = map.get(`${side}@${slug}`); if (bySlug != null) return bySlug; }
  return null;
}

/** The board headline: the sum of the resolver's per-window rows, read as
 *  you/them. EXACTLY what the app's own totals do.
 *
 *  Those rows already carry the contested window's +5 and everything the live
 *  resolve settles — they sum to the totals the worker writes as
 *  home_final/away_final — so summing them here is not an approximation of the
 *  official score, it IS the official score.
 *
 *  Null when there is nothing published (off the live board, or before the
 *  first resolve), and the caller keeps its local sim. */
export function srvBoardTotals(states: SrvWindowScore[] | null | undefined, youAreHome: boolean): { you: number; them: number } | null {
  if (!states?.length) return null;
  let home = 0, away = 0;
  for (const s of states) { home += Number(s.home_score) || 0; away += Number(s.away_score) || 0; }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return youAreHome ? { you: r1(home), them: r1(away) } : { you: r1(away), them: r1(home) };
}

/** The precedence a live score is displayed under, at any level (window bar,
 *  player card, board headline).
 *
 *   1. FINAL — the local engine's settled value. It resolves the best-ball sub,
 *      negation, halving and the drip TAIL (accrual between the last play and
 *      the whistle) that a last-play playback ceiling cuts, and it is what the
 *      window bar has always shown at final.
 *   2. LIVE, with a published row — the resolver's number. See the header.
 *   3. LIVE, nothing published — the local bank. Unchanged behaviour, and the
 *      only correct answer on the sim/demo boards, which have no server at all
 *      and where the clock is genuinely scrubbable. */
export function shownScore(opts: { final: boolean; settled?: number | null; srv?: number | null; bank: number }): number {
  if (opts.final) return opts.settled ?? opts.bank;
  if (opts.srv != null && Number.isFinite(opts.srv)) return opts.srv;
  return opts.bank;
}
