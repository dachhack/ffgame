// Honest pre-game AI lineup builder — the single source of truth for how an
// AI-controlled (or auto-filled / missed-pick) team sets its lineup in LIVE play.
//
// "Honest" = no hindsight. A real pre-game AI cannot know the week's results, so
// it picks a sensible DEFAULT metric per position and a light Field-General
// coordination heuristic — never "the metric that scored highest in the already-
// played week" (what the old src/data/optimizeLineup did, only valid for baked
// past weeks). This is the builder the worker (server/src/engine.js:autoLineup)
// and the admin force-resolve (src/data/forceResolve.ts) both call.
import type { Pos } from '../types';
import { WINDOWS, TOTAL_SLOTS, metricById } from './metrics';
import { slugMeta } from './slugMeta';
import { statsForSlug } from './players';
import { hasSlate, windowForTeam, windowsForWeek } from './nflSlate';

// Sensible default metric per position. Each is a steady, predictable scorer for
// that spot — chosen WITHOUT seeing the week's box score. This also fixes a real
// bug in the old auto path: defaultMetric(pos) returned each position's FIRST
// catalog entry, which is `fg` for QB and `suppress` for DEF — both score 0 for
// the player himself, so every auto-fielded QB and DST banked nothing. (Mirrors
// the map in server/src/simulate.js, which imports this constant.)
export const DEFAULT_AI_METRIC: Record<Pos, string> = {
  QB: 'pass', RB: 'rush', WR: 'recyd', TE: 'recyd',
  K: 'banker', DEF: 'earn', DL: 'idp_tackles', LB: 'idp_tackles', DB: 'idp_tackles',
};

/** The honest default scoring metric for a position. */
export function defaultAiMetric(pos: Pos): string {
  return DEFAULT_AI_METRIC[pos] ?? 'rush';
}

// Combo Drip pays only for a genuine dual-threat: the default rush (RB) / recyd
// (WR) drip counts ONE phase of touches, while combodrip feeds the drip from
// BOTH carries and catches. So the AI arms it only when a player has real season
// volume on each side — a pure runner or pure receiver gains nothing. Per-game
// yard floors (tunable).
const COMBO_RUSH_YPG = 20;
const COMBO_REC_YPG = 20;

/** Whether a dual-threat RB/WR is worth Combo Drip — real season volume on BOTH
 *  carries and catches. The pre-game read for the AI's combo-drip purchase. */
export function wantsComboDrip(slug: string, pos: Pos): boolean {
  if (pos !== 'RB' && pos !== 'WR') return false;
  const s = statsForSlug(slug, pos);
  const g = Math.max(1, s.games);
  return s.rushYds / g >= COMBO_RUSH_YPG && s.recYds / g >= COMBO_REC_YPG;
}

/** The metric the AI assigns a player pre-game: combodrip for a dual-threat RB/WR
 *  ONLY when the team actually OWNS the unlock (it's a paid power-up — the AI buys
 *  it within its coin budget, like a human), otherwise the position default.
 *  A QB flips to `passbig` when Air Raid is owned — it strictly dominates `pass`
 *  for the holder (same 0.04/yd, 10 vs 4 per passing TD); the budget pass only
 *  buys the unlock when the lineup deploys no Field General (findings §18), so
 *  the flip is never wasted on a QB that applyFieldGeneral will take.
 *  Honest — reads only season totals, never the week's result. */
export function aiMetric(slug: string, pos: Pos, owned: Set<string> = new Set()): string {
  if (owned.has('unlock-combo-drip') && wantsComboDrip(slug, pos)) return 'combodrip';
  if (pos === 'QB' && owned.has('unlock-pass-td10')) return 'passbig';
  return defaultAiMetric(pos);
}

export interface AiPick { win: string; slot: string; slug: string; metric: string }

// How many same-window non-QB DRIP slots make Field General worth running. FG
// scores the QB nothing but multiplies its side's drip players in that window
// (windowFgMult / resolveSlot), so it only pays once enough drip shares the
// window. Tunable — raise it to make the AI more conservative about FG.
const FG_DRIP_THRESHOLD = 2;

/** A metric is "drip" if its catalog tag advertises drip accrual (rush/recyd and
 *  the combo/return unlocks) — the metrics a Field General multiplier amplifies. */
function isDrip(pos: Pos, metric: string): boolean {
  const m = metricById(pos, metric);
  return !!m && m.tag.includes('DRIP');
}

/** Positions that CAN run a drip (and so benefit from a Field General). K/DEF cannot —
 *  they are the lone "special situation" where a non-drip shares an FG window. */
const DRIP_POS = new Set<Pos>(['RB', 'WR', 'TE']);

/** Field-General coordination: in any window holding a QB plus ≥ threshold non-QB
 *  drip slots, flip that QB onto `fg` so its passing yards multiply the window's
 *  drip instead of banking flat points. Honest — it's a pre-game read of the
 *  lineup's own composition, not the opponent's or the week's result.
 *
 *  Guarantee: a deployed Field General never shares its window with a wasted slot —
 *  every drip-CAPABLE teammate (RB/WR/TE) there is forced onto its drip metric, since
 *  the multiplier only amplifies drips. K/DEF have no drip and are the sole exception.
 *  Today the position defaults already drip, so this only hardens the invariant against
 *  a future default/override change ever sneaking a non-drip into a General's window. */
function applyFieldGeneral(picks: AiPick[], owned: Set<string> = new Set()): void {
  const byWin = new Map<string, AiPick[]>();
  for (const p of picks) {
    const g = byWin.get(p.win);
    if (g) g.push(p); else byWin.set(p.win, [p]);
  }
  for (const group of byWin.values()) {
    const qbs = group.filter((p) => slugMeta(p.slug).pos === 'QB');
    const qb = qbs[0];
    if (!qb) continue;
    const skill = group.filter((p) => !qbs.includes(p) && DRIP_POS.has(slugMeta(p.slug).pos));
    const drips = skill.filter((p) => isDrip(slugMeta(p.slug).pos, p.metric));
    if (drips.length >= FG_DRIP_THRESHOLD) {
      qb.metric = 'fg';
      // TWIN GENERALS (§18): with the fg-stack buff OWNED and a second QB in the
      // window, flip it onto fg too — the top two multipliers multiply. Only when
      // bought (the budget pass gates the buy on this exact situation existing).
      if (owned.has('fg-stack') && qbs[1]) qbs[1].metric = 'fg';
      for (const p of skill) if (!isDrip(slugMeta(p.slug).pos, p.metric)) p.metric = defaultAiMetric(slugMeta(p.slug).pos);
    }
  }
}

// The in-slot buffs an AI team arms in a live week, in EXPECTED-VALUE order. The
// automated playtester (tools/playtester) shows these three drip AMPLIFIERS are the
// only buffs that actually lift honest win-rate — momentum (3× when hot), overtime
// (drips + Field General carry past regulation), garbage-time (final-5-min ×2) — while
// the defensive buffs (floodgates / ot-shield) are dead against the honest field
// (nobody nukes) and only waste coin. Dropping them and buying these first is a measured
// +6.6-margin / ~59% blind win-rate improvement vs the old random draw (docs/playtester-
// findings.md §5). The demo AI keeps its own AI_BUFF_POOL in src/engine/matchup.ts.
const AI_LIVE_BUFFS = ['momentum', 'overtime', 'garbage-time'];

/** Deterministic 32-bit hash for seeding the AI's draws (no Math.random, so the
 *  worker and a preview agree and a re-resolve is stable). */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** An AI team's armed in-slot buffs for a live week — a deterministic draw
 *  (seeded per team+week) from the buffs that benefit the arming side. Honest:
 *  seeded only on identity + week, never on the week's results. In M1 these are
 *  free; a later milestone gates them behind the team's coin budget. */
export function aiLiveBuffs(teamKey: string, week: number, n = 3): string[] {
  // EV-ordered, rotated per team+week so different AI teams lead with a different
  // amplifier (harmless variety) without ever leaving the proven-good set. The budget
  // pass buys the first it can afford, so the lead buff is what most teams end up with.
  const pool = AI_LIVE_BUFFS;
  const start = hashStr(`${teamKey}|buffs|${week}`) % pool.length;
  const out: string[] = [];
  for (let i = 0; i < Math.min(n, pool.length); i++) out.push(pool[(start + i) % pool.length]);
  return out;
}

// ── Targeted battle plays (RETRAINED policy, findings §17) ───────────────────
// The lever sweep (tools/playtester/aggregate.mjs, weeks 1-14 × 200 pairs) put
// two targeted plays above or near the amps on lift-per-coin, and both are
// BLIND-legal (they read only the AI's own lineup):
//   • RIVALRY on the AI's densest window — the honest field mirrors positions
//     heavily, so the siphon lands often (64.1% / +19.6 margin / 2.80 pts per
//     10 coin — better per-coin than momentum).
//   • GHOST when the lineup leaves a base slot open (slate gaps) — a flat 14
//     beats an empty slot every time (58.5% / +11.3 / 1.51 per 10 coin).
// Everything else measured at or below fair vs an honest blind field (grudge,
// lead-change, jinx, napalm, bunker...) and stays human-only.

/** Blind targets for the AI's bought battle plays, read off its OWN built
 *  lineup: rivalry = its densest window (max mirror probability), ghost = the
 *  first base window slot the lineup left unfilled (null = lineup is full). */
export function aiTargetedPlays(picks: AiPick[], week: number): { rivalry: string | null; ghost: string | null } {
  const perWin = new Map<string, number>();
  for (const p of picks) perWin.set(p.win, (perWin.get(p.win) ?? 0) + 1);
  let rivalry: string | null = null, most = 0;
  for (const [w, k] of perWin) if (k > most) { rivalry = w; most = k; }
  const taken = new Set(picks.map((p) => `${p.win}|${p.slot}`));
  let ghost: string | null = null;
  outer: for (const w of windowsForWeek(week)) {
    for (let i = 0; i < w.slots; i++) {
      const k = `${w.id}|${i}`;
      if (!taken.has(k)) { ghost = k; break outer; }
    }
  }
  return { rivalry, ghost };
}

/** STACK policy switches (findings §18) — which conditional add-on buys the
 *  shipping AI makes when the wallet allows AND its lineup creates the
 *  situation. ONE source of truth: every budget mirror (tools/playtester
 *  lib.mjs + season.mjs, server/src/lock.js) reads these; the season probes
 *  override them per-arm to measure each stack before it's adopted. */
export interface AiStacks { raid: boolean; raidFirst: boolean; don: boolean; herring: boolean; stackExtras: boolean; twinFg: boolean }
// Measured verdicts (season probes, 12×14×60 — 840 team-0 games/arm): the
// raid-FIRST stack is the one conditional add-on that EARNS at the table
// (+1.4 pts, fires 10.1 weeks/season). The rest never fire at the current
// economy — after amp + rivalry the wallet never holds an ◎80+ surplus, and a
// twin-QB window can't meet the FG drip threshold (windows hold 1-3 slots) —
// so they ship OFF but stay probed every battery in case the economy shifts.
export const AI_STACKS: AiStacks = {
  raid: true,         // Air Raid add-on when no Field General deploys (QB → passbig)
  raidFirst: true,    // …bought BEFORE the first amp (§16's raid-then-amp order, +1.4 pts)
  don: false,         // surplus → Double-or-Nothing staked on its top slot (never fires)
  herring: false,     // surplus → Red Herring on a genuinely cheap WR decoy (never fires)
  stackExtras: false, // bought extra slots point INTO the rivalry window (extras never bought)
  twinFg: false,      // Twin Generals: both QBs share a window with drips (situation ~never exists)
};

/** The full roster-aware battle plan (STACK policy, findings §18) — everything
 *  the budget pass needs to decide conditional add-on buys, still strictly
 *  blind (season projections + its own deterministic lineup, never the
 *  opponent or the week's result):
 *    • rivalry / ghost — as aiTargetedPlays.
 *    • topSlot — its highest-projected skill slot (`win|slot`), the Double-or-
 *      Nothing stake: the slot most likely to win its head-to-head.
 *    • decoyWr — its LOWEST-projected WR slot in a window with ≥2 of its own
 *      players (`win|slot`), the Red Herring decoy; null when every WR is a
 *      real scorer (no cheap decoy → the play isn't a good situation).
 *    • fgDeployed — the lineup runs a Field General; buying Air Raid would be
 *      wasted on a QB that scores 0 for itself. */
export function aiBattlePlan(picks: AiPick[], week: number): {
  rivalry: string | null; ghost: string | null; topSlot: string | null; decoyWr: string | null; fgDeployed: boolean; twinQbWin: string | null;
} {
  const { rivalry, ghost } = aiTargetedPlays(picks, week);
  const SKILL = new Set<Pos>(['RB', 'WR', 'TE']);
  const proj = (p: AiPick) => statsForSlug(p.slug, slugMeta(p.slug).pos).ppr || 0;
  let topSlot: string | null = null, top = -Infinity;
  for (const p of picks) {
    if (!SKILL.has(slugMeta(p.slug).pos)) continue;
    const v = proj(p);
    if (v > top) { top = v; topSlot = `${p.win}|${p.slot}`; }
  }
  const perWin = new Map<string, number>();
  for (const p of picks) perWin.set(p.win, (perWin.get(p.win) ?? 0) + 1);
  // A decoy is only a decoy when it's genuinely cheap: the lineup's weakest WR,
  // and clearly below the top skill projection (< 60%) — otherwise capping the
  // opponent to it caps nothing.
  let decoyWr: string | null = null, low = Infinity;
  for (const p of picks) {
    if (slugMeta(p.slug).pos !== 'WR' || (perWin.get(p.win) ?? 0) < 2) continue;
    const v = proj(p);
    if (v < low) { low = v; decoyWr = `${p.win}|${p.slot}`; }
  }
  if (decoyWr && top > 0 && low > top * 0.6) decoyWr = null;
  // Twin Generals situation: a window ALREADY running a Field General that also
  // holds a second QB — fg-stack would multiply the top two multipliers there.
  let twinQbWin: string | null = null;
  for (const p of picks) {
    if (p.metric !== 'fg') continue;
    if (picks.some((q) => q !== p && q.win === p.win && slugMeta(q.slug).pos === 'QB')) { twinQbWin = p.win; break; }
  }
  return { rivalry, ghost, topSlot, decoyWr, fgDeployed: picks.some((p) => p.metric === 'fg'), twinQbWin };
}

interface Tagged { slug: string; pos: Pos; team: string; metric: string }

/** Build an AI lineup from a roster's starter slugs, each on its honest pre-game
 *  metric, then run the Field-General read. Returns [{ win, slot, slug, metric }].
 *
 *  When the week's NFL slate is known, the AI is SLATE-GATED exactly like a human
 *  in LivePicks: every player may only occupy the window his real team plays, a
 *  player on bye is unslottable, and a window that fills overflows to the bench.
 *  This closes the fairness gap where the AI could grid-fill synthetic windows a
 *  human can't use. Without a slate (weeks we have no schedule for) it falls back
 *  to the deterministic grid-fill. No hindsight either way — placement reads only
 *  the schedule and the AI's own roster, never the opponent or the week's result. */
export function aiLineup(slugs: string[], week = 0, owned: Set<string> = new Set(), extraSlots = 0): AiPick[] {
  const tagged: Tagged[] = (slugs ?? []).filter(Boolean).map((slug) => {
    const { pos, team } = slugMeta(slug);
    return { slug, pos, team, metric: aiMetric(slug, pos, owned) };
  });
  // Field the BEST players first: place/overflow in descending season projection so a
  // full window keeps its higher-projected starters and benches the weaker ones — never
  // sitting a WR ranked 23rd behind one ranked 65th just because of roster order.
  tagged.sort((a, b) => statsForSlug(b.slug, b.pos).ppr - statsForSlug(a.slug, a.pos).ppr);
  // COMBO DRIP is one-for-one (one slot per unlock purchased). The AI's budget
  // pass buys at most ONE unlock, so keep it on the BEST dual-threat only;
  // later candidates fall back to the position default.
  let comboUsed = false;
  for (const t of tagged) {
    if (t.metric !== 'combodrip') continue;
    if (!comboUsed) { comboUsed = true; continue; }
    t.metric = defaultAiMetric(t.pos);
  }

  const { picks, bench } = hasSlate(week) ? slateGated(tagged, week) : gridFill(tagged);
  addExtraSlots(picks, bench, extraSlots, week);
  applyFieldGeneral(picks, owned);
  return picks;
}

/** A player who didn't make the base lineup but CAN still be fielded — overflow
 *  from a full window, tagged with the window it's eligible for. Never a bye. */
interface Benched { win: string; p: Tagged }

/** Window-stacking for purchased extra slots (M4c): spend each extra slot on the
 *  deepest window — the one with the most benched players — fielding its next-best
 *  bench player on a steady FLOOR metric (never combodrip; an attack/drip metric
 *  is wasted in what becomes an unopposed best-ball slot). In-window + never-bye
 *  by construction (bench only holds windowed overflow). Deterministic: window
 *  order breaks ties, bench is in roster order. Extra slots are named 'x0','x1',…
 *  to match the sell/cap SQL (roster_slot ~ '^x[0-9]+$'). */
function addExtraSlots(picks: AiPick[], bench: Benched[], extraSlots: number, week: number): void {
  const wins = windowsForWeek(week);
  for (let i = 0; i < extraSlots && bench.length; i++) {
    const count = new Map<string, number>();
    for (const b of bench) count.set(b.win, (count.get(b.win) ?? 0) + 1);
    let deepest = bench[0].win, most = -1;
    for (const w of wins) { const n = count.get(w.id) ?? 0; if (n > most) { most = n; deepest = w.id; } }
    const idx = bench.findIndex((b) => b.win === deepest);
    const { p } = bench.splice(idx, 1)[0];
    picks.push({ win: deepest, slot: `x${i}`, slug: p.slug, metric: defaultAiMetric(p.pos) });
  }
}

/** Slate-gated placement: each player into the window his NFL team plays; byes
 *  are unslottable; window-overflow is benched (returned for extra-slot stacking).
 *  Flexible players (no resolvable team) fill whatever slots remain, in window
 *  order, and overflow to the marquee window's bench. */
function slateGated(tagged: Tagged[], week: number): { picks: AiPick[]; bench: Benched[] } {
  const wins = windowsForWeek(week);
  const free = new Map<string, number[]>();
  for (const w of wins) free.set(w.id, Array.from({ length: w.slots }, (_, i) => i));
  const place = (winId: string, p: Tagged): boolean => {
    const slots = free.get(winId);
    if (!slots || !slots.length) return false;
    picks.push({ win: winId, slot: String(slots.shift()), slug: p.slug, metric: p.metric });
    return true;
  };

  const picks: AiPick[] = [];
  const bench: Benched[] = [];
  const marquee = wins.reduce((a, b) => (b.slots > a.slots ? b : a)).id;
  const flexible: Tagged[] = [];
  for (const p of tagged) {
    if (!p.team) { flexible.push(p); continue; }      // unknown team → eligible anywhere
    const win = windowForTeam(week, p.team);           // WindowId | null (bye)
    if (!win) continue;                                // bye → unslottable
    if (!place(win, p)) bench.push({ win, p });        // window full → bench (keep its window)
  }
  for (const p of flexible) { let placed = false; for (const w of wins) if (place(w.id, p)) { placed = true; break; } if (!placed) bench.push({ win: marquee, p }); }
  return { picks, bench };
}

/** No-slate fallback: lay players across the fixed window/slot grid, with the
 *  first QB seated in the marquee multi-slot window so Field General can still
 *  coordinate a QB that would otherwise be stranded in a 1-slot window. Leftover
 *  pool players become bench (in the marquee window) for extra-slot stacking. */
function gridFill(tagged: Tagged[]): { picks: AiPick[]; bench: Benched[] } {
  const pool = tagged.slice(0, TOTAL_SLOTS);
  const marquee = WINDOWS.reduce((a, b) => (b.slots > a.slots ? b : a));
  const leftover = tagged.slice(TOTAL_SLOTS);
  const qbIdx = pool.findIndex((p) => p.pos === 'QB');
  const reserved = qbIdx >= 0 ? pool.splice(qbIdx, 1)[0] : undefined;

  const picks: AiPick[] = [];
  let i = 0;
  for (const w of WINDOWS) {
    for (let s = 0; s < w.slots; s++) {
      const p = reserved && w.id === marquee.id && s === 0 ? reserved : pool[i++];
      if (p) picks.push({ win: w.id, slot: String(s), slug: p.slug, metric: p.metric });
    }
  }
  return { picks, bench: leftover.map((p) => ({ win: marquee.id, p })) };
}
