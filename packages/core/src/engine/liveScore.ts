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
export interface SrvSlotScore { side: 'home' | 'away'; slot?: string | number | null; slug?: string | null; metric?: string | null; score: number }
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

/** The resolver row for one slot, matched the ONE way both hosts must agree
 *  on: by roster slot first (it is what savePicks wrote), by slug as the
 *  fallback (survives slot renumbering). This returns the whole row — the app
 *  reads hot/nuked flags off it, not just the score — where decodeSrvSlots
 *  above is the memo-safe two-number form the web's WindowSection needs.
 *  Same precedence in both; if the rule ever needs to change, it changes here
 *  for everyone or the two hosts pin different rows to the same card. */
export function srvSlotRow<T extends SrvSlotScore>(rows: T[] | null | undefined, side: 'home' | 'away', slot: string | number, slug?: string | null): T | undefined {
  if (!rows?.length) return undefined;
  const bySlot = rows.find((r) => r.side === side && r.slot != null && String(r.slot) === String(slot));
  if (bySlot) return bySlot;
  return slug ? rows.find((r) => r.side === side && r.slug === slug) : undefined;
}

/** ── THE LINEUP THE RESOLVER COMPOSED (v0.456.1) ────────────────────────────
 *
 *  A seat's cards come from `sealed_pick`. Not every fielded lineup is in
 *  there: `sideLineup` (server/src/resolve.js) BUILDS a side at resolve time —
 *  and scores it — for an AI-controlled seat with no sealed rows, for a seat
 *  that is unenrolled or unclaimed, and for any seat that set nothing under a
 *  policy other than 'empty'. `materializeAutoLineups` writes most of those
 *  back at lock, but declines to for an AI seat on purpose: its persona draw
 *  and its bought buffs live in `aiSide`, and storing rows would strip them.
 *
 *  So those players exist in exactly one place a client can read: the
 *  resolver's own per-slot rows, where `slug` and `metric` ride beside the
 *  score. A board that reads only sealed_pick draws NO PLAYER against a live
 *  number — the founder's "my opponent has zero players slotted against me",
 *  with 104.2 on the same screen.
 *
 *  NOTHING LEAKS BY READING THEM. The worker publishes a window's slot rows
 *  only once that window has kicked off (resolve.js `started(win)`), which is
 *  the same moment the sealed_select RLS opens the opponent's real rows (0262).
 *  A pick still sealed is not in here to find.
 *
 *  GHOST AND BYE ARE NOT PICKS. Two power-ups publish a slot row for a player
 *  nobody fielded — a Ghost's flat 14, a Bye Steal's projection. They score,
 *  and they are not a lineup, so they never become a card.
 *
 *  The web has read them since v0.387.5; this is that rule, lifted out so the
 *  app shares it and `scripts/check-slotcard.mjs` can pin it. */
export const PHANTOM_SLOT_METRICS = new Set(['ghost', 'bye']);

/** One pick as the resolver published it, shaped like the sealed row it stands
 *  in for. */
export interface SrvPick { game_window: string; roster_slot: string; player_slug: string; metric_id: string | null }

/** A side's picks from one window's published rows, for the slots `covered`
 *  does not already hold a readable sealed row for. Empty when the window has
 *  published nothing (it has not kicked), which is also when a missing card is
 *  honestly still a secret. */
export function srvSidePicks(
  win: string,
  rows: SrvSlotScore[] | null | undefined,
  side: 'home' | 'away',
  covered: readonly (string | number)[] = [],
): SrvPick[] {
  if (!rows?.length) return [];
  const have = new Set(covered.map(String));
  const out: SrvPick[] = [];
  for (const r of rows) {
    if (r.side !== side || !r.slug || r.slot == null || String(r.slot) === '') continue;
    if (r.metric && PHANTOM_SLOT_METRICS.has(r.metric)) continue;
    const slot = String(r.slot);
    if (have.has(slot)) continue;   // a sealed row always wins its own slot
    have.add(slot);                 // …and the first published row wins a duplicate
    out.push({ game_window: win, roster_slot: slot, player_slug: r.slug, metric_id: r.metric ?? null });
  }
  return out;
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

// ── FIELD GENERAL, AFTER THE FACT (v0.388.11) ─────────────────────────────
// Founder, Sunday afternoon, the multiplier chip gone from every card: "did
// my field general apply?" It had — the boost is baked into every drip tick
// and every flat play as it banks (sim.ts minuteGain / resolveSlot stamp the
// event's `mult`) — but the card showed only the LIVE multiplier, and that
// resets when regulation ends (Overtime carries it). Once it read ×1.00 there
// was no trace. This sums the trace: for one side, up to a clock, how much of
// the bank exists only because of the multiplier. Each event's delta is the
// post-multiplier amount, so the boost is delta − delta/mult. Negative
// deltas (a Napalm burn) carry no mult and are skipped by the guard.
export function fgBoostAt(
  events: ReadonlyArray<{ clock: number; side: string; delta: number; mult?: number }>,
  side: 'you' | 'their',
  clock: number,
): number {
  let boost = 0;
  for (const e of events) {
    if (e.side !== side || e.clock > clock) continue;
    if (!(e.mult && e.mult > 1) || !(e.delta > 0)) continue;
    boost += e.delta - e.delta / e.mult;
  }
  return Math.round(boost * 10) / 10;
}
