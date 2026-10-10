// DFS BULLSEYE (v0.660.0) — classic Bullseye's dart on a salary-cap squad.
// Spec: docs/dfs-bullseye.md. The dart itself (rings, the zero rule, the
// penalty, the radius) is bullseye.ts, unchanged; this module is the squad
// shape, the card for it, the scoring of a squad week, and the aim-aware
// auto-build. Pure: the worker scores with it, both clients preview with it.
import { applyBullseye, bullseyeConfigOf, dealBullseyeCard, ringScore, type BullseyeCard, type BullseyeConfig } from './bullseye';
import type { ClassicResult, ClassicSlotScore } from './classic';

/** The contest squad (0092's shape) with a NAME per slot, in order. */
export const DFS_SLOTS = [
  { slot: 'QB', pos: ['QB'], type: 'QB' },
  { slot: 'RB1', pos: ['RB'], type: 'RB' },
  { slot: 'RB2', pos: ['RB'], type: 'RB' },
  { slot: 'WR1', pos: ['WR'], type: 'WR' },
  { slot: 'WR2', pos: ['WR'], type: 'WR' },
  { slot: 'WR3', pos: ['WR'], type: 'WR' },
  { slot: 'TE', pos: ['TE'], type: 'TE' },
  { slot: 'K', pos: ['K'], type: 'K' },
  { slot: 'DEF', pos: ['DEF'], type: 'DEF' },
] as const;
export type DfsSlot = (typeof DFS_SLOTS)[number]['slot'];
export const DFS_SLOT_NAMES: DfsSlot[] = DFS_SLOTS.map((d) => d.slot);
export const DFS_CAP = 50000;
export const DFS_MIN_SALARY = 3000;
export const dfsSlotPos = (slot: string): string | null => DFS_SLOTS.find((d) => d.slot === slot)?.pos[0] ?? null;
/** "RB1" → "RB", for labels: the slot's position and, where there are two or
 *  three, its number. */
export const dfsSlotLabel = (slot: string): string => (slot === 'DEF' ? 'D/ST' : slot);

/** The league's setting, or null when it doesn't play DFS Bullseye. Always a
 *  SHARED card: a contest's whole point is that everyone aims at the same
 *  numbers. */
export function dfsBullseyeConfigOf(settings?: { dfs_bullseye?: unknown; bullseye?: string | null; bullseye_radius?: number | null } | null): BullseyeConfig | null {
  if (settings?.dfs_bullseye !== true) return null;
  const c = bullseyeConfigOf({ bullseye: settings.bullseye ?? 'slots', bullseye_radius: settings.bullseye_radius ?? null });
  return c ? { ...c, deal: 'shared' } : null;
}

/** The week's card for a contest league — classic's dealer over the nine
 *  slots, stock catalog (contests score standard full PPR), seeded on
 *  (league, week): the worker, both clients and a probe deal the same. */
export function dfsCard(leagueId: string, week: number): BullseyeCard {
  return dealBullseyeCard(leagueId, week, DFS_SLOTS.map((d) => ({ slot: d.slot, type: d.type, pos: [...d.pos] })));
}

/** A stored squad (sleeper_lineup.starters_json) as slot → slug. Named slots
 *  (save_bullseye_entry) are read by name; a squad saved the older way
 *  (save_pod_entry, an AI build — numbered slots in position order) fills
 *  the named slots in that order, RB1 before RB2. */
export function dfsSlotsOf(starters: unknown): Record<DfsSlot, string | null> {
  const out = Object.fromEntries(DFS_SLOT_NAMES.map((s) => [s, null])) as Record<DfsSlot, string | null>;
  const rows = Array.isArray(starters) ? starters as { slot?: unknown; player_slug?: unknown; pos?: unknown; grp?: unknown }[] : [];
  const loose: { slug: string; pos: string }[] = [];
  for (const r of rows) {
    const slug = typeof r?.player_slug === 'string' && r.player_slug ? r.player_slug : null;
    if (!slug || r?.grp) continue;
    if (typeof r.slot === 'string' && (DFS_SLOT_NAMES as string[]).includes(r.slot)) out[r.slot as DfsSlot] = slug;
    else loose.push({ slug, pos: String(r.pos ?? '').toUpperCase() });
  }
  for (const p of loose) {
    const open = DFS_SLOTS.find((d) => d.pos[0] === p.pos && out[d.slot] == null);
    if (open) out[open.slot] = p.slug;
  }
  return out;
}

// ── THE TIE-BREAKER (v0.660.1) ────────────────────────────────────────────
// Founder: "the CPU picks one spot per team either WR or RB and sets a target
// (keeping in mind the overall target and typical contribution of the spot)
// for that spot for that team … Distance from this spot target is used for
// tie breakers only and is known to the manager before they build their team."
//
// Per (league, week, ROSTER): one of RB1 RB2 WR1 WR2 WR3, and a number near
// that slot's own card target — the card's targets are its share of the total
// in either variant — moved 1–4 points either way, so it is a real
// prediction ("12", not the card's 10) and two teams rarely share one.
export const TIEBREAK_SLOTS: DfsSlot[] = ['RB1', 'RB2', 'WR1', 'WR2', 'WR3'];
export interface DfsTiebreak { slot: DfsSlot; target: number }
export function dfsTiebreak(leagueId: string, week: number, rosterId: number, card: BullseyeCard): DfsTiebreak {
  const r = mulberry(`tiebreak|${leagueId}|${week}|${rosterId}`);
  const slot = TIEBREAK_SLOTS[Math.floor(r() * TIEBREAK_SLOTS.length) % TIEBREAK_SLOTS.length];
  const mag = 1 + Math.floor(r() * 4);
  const sign = r() < 0.5 ? -1 : 1;
  const base = card.targets[slot] ?? 10;
  return { slot, target: Math.max(3, base + sign * mag) };
}
/** How far the tie-break spot landed — LOWER wins a tie. A zero (or an empty
 *  spot) is the whole target plus the radius: the dart's own zero penalty. */
export function tiebreakDistance(points: number | null | undefined, target: number, radius: number): number {
  if (points == null || !Number.isFinite(points) || Math.abs(points) < 1e-9) return Math.round((target + radius) * 10) / 10;
  return Math.round(Math.abs(points - target) * 10) / 10;
}

/** Score a week's squads under the card. `pointsOf` is the player's real
 *  points for the week (the worker: classicPoints under stock PPR). Rows are
 *  the classic 'wk' window so they reveal with the classic rule. A SOLO row
 *  (the open contest pairs a seat with itself) scores the same squad on both
 *  sides, which is what a board reading `home` wants. */
export function scoreDfsBullseye(
  squads: { home: Record<string, string | null>; away: Record<string, string | null> },
  card: BullseyeCard, cfg: BullseyeConfig,
  pointsOf: (slug: string, slot: string) => number,
  opts: {
    /** SEALED (v0.660.1): a player whose game hasn't started yet. His row is
     *  not written (an opponent must not learn who he is) and he is neither
     *  scored nor penalised as a zero until it has. Omitted at the final. */
    pending?: (slug: string) => boolean;
    /** Each side's tie-break spot (dfsTiebreak). */
    tiebreak?: { home?: DfsTiebreak | null; away?: DfsTiebreak | null };
  } = {},
): ClassicResult & { tiebreak: { home: number | null; away: number | null } } {
  const pending = opts.pending ?? (() => false);
  const sideRows = { home: [] as ClassicSlotScore[], away: [] as ClassicSlotScore[] };
  const counted = { home: 0, away: 0 };
  const tb = { home: null as number | null, away: null as number | null };
  for (const side of ['home', 'away'] as const) {
    const t = opts.tiebreak?.[side] ?? null;
    let tbDone = false;
    for (const d of DFS_SLOTS) {
      const slug = squads[side][d.slot] ?? null;
      if (slug && pending(slug)) continue;   // sealed and unscored until his game starts
      counted[side]++;
      if (!slug) continue;                   // an empty slot is a zero — the penalty finds the missing row
      const score = Math.round(pointsOf(slug, d.slot) * 10) / 10;
      sideRows[side].push({ win: 'wk', side, slot: d.slot, slug, metric: null, score });
      if (t && t.slot === d.slot) { tb[side] = tiebreakDistance(score, t.target, cfg.radius); tbDone = true; }
    }
    // The tie-break spot left empty is a zero; one still to play has no distance yet.
    if (t && !tbDone && !(squads[side][t.slot] && pending(squads[side][t.slot]!))) tb[side] = tiebreakDistance(0, t.target, cfg.radius);
  }
  // Each side is darted over the spots it has actually played: a player still
  // to kick off is not a zero yet. At the final nothing is pending, and this
  // is exactly applyBullseye over all nine.
  const dartSide = (side: 'home' | 'away') => {
    // applyBullseye darts the 'home' rows; each side is run through it as home.
    const rows = sideRows[side].map((r) => ({ ...r, side: 'home' as const }));
    const pts = rows.reduce((s, r) => s + r.score, 0);
    const res = applyBullseye({ home: pts, away: 0, slots: rows, states: [{ window: 'wk', home: pts, away: 0 }] }, { cfg, card }, Math.max(1, counted[side]));
    return { ring: res.home, rows: res.slots.filter((r) => r.side === 'home').map((r) => ({ ...r, side })), summary: res.bullseye?.home };
  };
  const h = dartSide('home'), a = dartSide('away');
  return {
    home: h.ring, away: a.ring, slots: [...h.rows, ...a.rows],
    states: [{ window: 'wk', home: h.ring, away: a.ring }],
    ...(h.summary && a.summary ? { bullseye: { variant: cfg.variant, radius: cfg.radius, home: h.summary, away: a.summary } } : {}),
    tiebreak: tb,
  };
}

export interface BoardPlayer { slug: string; pos: string; salary: number; proj: number; name?: string; team?: string }

/** THE AIMED AUTO-BUILD — an AI seat or a no-show in a Bullseye league. The
 *  pods' greedy build maximises projection; here each slot takes the
 *  affordable player whose projection lands closest to its target (TOTAL
 *  aims each slot at its share of the card, which is the same thing), always
 *  reserving the minimum salary per slot still to fill so it can never bust
 *  the cap. Seeded jitter keeps two seats on one card from building alike.
 *  Slots are filled hardest-first: the biggest target, where the fewest
 *  players land, chooses before the 5s. */
export function aimBuild(board: BoardPlayer[], card: BullseyeCard, seed: string, cap = DFS_CAP): Record<DfsSlot, string | null> {
  const rand = mulberry(seed);
  const out = Object.fromEntries(DFS_SLOT_NAMES.map((s) => [s, null])) as Record<DfsSlot, string | null>;
  const order = [...DFS_SLOTS].sort((a, b) => (card.targets[b.slot] ?? 0) - (card.targets[a.slot] ?? 0));
  const jitter = new Map(board.map((p) => [p.slug, (rand() - 0.5) * 1.5]));
  const taken = new Set<string>();
  let budget = cap;
  order.forEach((d, i) => {
    const target = card.targets[d.slot] ?? 0;
    const maxSpend = budget - (order.length - i - 1) * DFS_MIN_SALARY;
    const pick = board
      .filter((p) => p.pos === d.pos[0] && !taken.has(p.slug) && p.salary <= maxSpend && p.proj > 0)
      .sort((a, b) => Math.abs(a.proj + (jitter.get(a.slug) ?? 0) - target) - Math.abs(b.proj + (jitter.get(b.slug) ?? 0) - target)
        || a.salary - b.salary)[0];
    if (!pick) return;
    taken.add(pick.slug);
    budget -= pick.salary;
    out[d.slot] = pick.slug;
  });
  return out;
}

/** What a projection would bank in a slot — the builder's preview, the same
 *  curve the week is scored on. */
export const projectedRing = (proj: number, target: number | undefined, radius: number): number => ringScore(proj, target ?? null, radius);

/** Squad salary. */
export const squadSalary = (slots: Record<string, string | null>, salaryOf: (slug: string) => number): number =>
  Object.values(slots).reduce((s, slug) => s + (slug ? salaryOf(slug) : 0), 0);

function mulberry(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  let a = h >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An opponent's squad as dfs_bullseye_state hands it over (v0.660.1): per
 *  slot, the player once his game has locked, else null (sealed). */
export function sealedSquadOf(entry: unknown): { slot: DfsSlot; slug: string | null }[] {
  const rows = Array.isArray(entry) ? entry as { slot?: unknown; player_slug?: unknown; sealed?: unknown }[] : [];
  const bySlot = new Map<string, string | null>();
  for (const r of rows) {
    if (typeof r?.slot !== 'string') continue;
    bySlot.set(r.slot, r.sealed ? null : (typeof r.player_slug === 'string' ? r.player_slug : null));
  }
  return DFS_SLOT_NAMES.map((slot) => ({ slot, slug: bySlot.get(slot) ?? null }));
}
