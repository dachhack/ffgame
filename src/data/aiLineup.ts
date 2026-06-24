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
import { hasSlate, windowForTeam } from './nflSlate';

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
 *  Honest — reads only season totals, never the week's result. */
export function aiMetric(slug: string, pos: Pos, owned: Set<string> = new Set()): string {
  if (owned.has('unlock-combo-drip') && wantsComboDrip(slug, pos)) return 'combodrip';
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

/** Field-General coordination: in any window holding a QB plus ≥ threshold non-QB
 *  drip slots, flip that QB onto `fg` so its passing yards multiply the window's
 *  drip instead of banking flat points. Honest — it's a pre-game read of the
 *  lineup's own composition, not the opponent's or the week's result. */
function applyFieldGeneral(picks: AiPick[]): void {
  const byWin = new Map<string, AiPick[]>();
  for (const p of picks) {
    const g = byWin.get(p.win);
    if (g) g.push(p); else byWin.set(p.win, [p]);
  }
  for (const group of byWin.values()) {
    const qb = group.find((p) => slugMeta(p.slug).pos === 'QB');
    if (!qb) continue;
    const drips = group.filter((p) => p !== qb && isDrip(slugMeta(p.slug).pos, p.metric));
    if (drips.length >= FG_DRIP_THRESHOLD) qb.metric = 'fg';
  }
}

// The in-slot buffs an AI team arms in a live week. Limited to whole-lineup
// buffs that help whichever side arms them (drip/OT/clock buffs) — so the AI
// always benefits — mirroring the demo's AI_BUFF_POOL (src/engine/matchup.ts).
const AI_LIVE_BUFFS = ['momentum', 'garbage-time', 'floodgates', 'overtime', 'ot-shield'];

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
  const pool = [...AI_LIVE_BUFFS];
  const out: string[] = [];
  let seed = hashStr(`${teamKey}|buffs|${week}`);
  for (let i = 0; i < n && pool.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff; // LCG step for a varied draw
    out.push(pool.splice(seed % pool.length, 1)[0]);
  }
  return out;
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
export function aiLineup(slugs: string[], week = 0, owned: Set<string> = new Set()): AiPick[] {
  const tagged: Tagged[] = (slugs ?? []).filter(Boolean).map((slug) => {
    const { pos, team } = slugMeta(slug);
    return { slug, pos, team, metric: aiMetric(slug, pos, owned) };
  });

  const picks = hasSlate(week) ? slateGated(tagged, week) : gridFill(tagged);
  applyFieldGeneral(picks);
  return picks;
}

/** Slate-gated placement: each player into the window his NFL team plays; byes
 *  and window-overflow are benched. Flexible players (no resolvable team) fill
 *  whatever slots remain, in window order. */
function slateGated(tagged: Tagged[], week: number): AiPick[] {
  const free = new Map<string, number[]>();
  for (const w of WINDOWS) free.set(w.id, Array.from({ length: w.slots }, (_, i) => i));
  const place = (winId: string, p: Tagged): boolean => {
    const slots = free.get(winId);
    if (!slots || !slots.length) return false;
    picks.push({ win: winId, slot: String(slots.shift()), slug: p.slug, metric: p.metric });
    return true;
  };

  const picks: AiPick[] = [];
  const flexible: Tagged[] = [];
  for (const p of tagged) {
    if (!p.team) { flexible.push(p); continue; }      // unknown team → eligible anywhere
    const win = windowForTeam(week, p.team);           // WindowId | null (bye)
    if (!win) continue;                                // bye → unslottable
    place(win, p);                                     // window full → benched (drop)
  }
  for (const p of flexible) for (const w of WINDOWS) if (place(w.id, p)) break;
  return picks;
}

/** No-slate fallback: lay players across the fixed window/slot grid, with the
 *  first QB seated in the marquee multi-slot window so Field General can still
 *  coordinate a QB that would otherwise be stranded in a 1-slot window. */
function gridFill(tagged: Tagged[]): AiPick[] {
  const pool = tagged.slice(0, TOTAL_SLOTS);
  const fgWin = WINDOWS.reduce((a, b) => (b.slots > a.slots ? b : a));
  const qbIdx = pool.findIndex((p) => p.pos === 'QB');
  const reserved = qbIdx >= 0 ? pool.splice(qbIdx, 1)[0] : undefined;

  const picks: AiPick[] = [];
  let i = 0;
  for (const w of WINDOWS) {
    for (let s = 0; s < w.slots; s++) {
      const p = reserved && w.id === fgWin.id && s === 0 ? reserved : pool[i++];
      if (p) picks.push({ win: w.id, slot: String(s), slug: p.slug, metric: p.metric });
    }
  }
  return picks;
}
