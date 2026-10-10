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

/** Score a week's squads under the card. `pointsOf` is the player's real
 *  points for the week (the worker: classicPoints under stock PPR). Rows are
 *  the classic 'wk' window so they reveal with the classic rule. A SOLO row
 *  (the open contest pairs a seat with itself) scores the same squad on both
 *  sides, which is what a board reading `home` wants. */
export function scoreDfsBullseye(
  squads: { home: Record<string, string | null>; away: Record<string, string | null> },
  card: BullseyeCard, cfg: BullseyeConfig,
  pointsOf: (slug: string, slot: string) => number,
): ClassicResult {
  const rows: ClassicSlotScore[] = [];
  const sideTotal = { home: 0, away: 0 };
  for (const side of ['home', 'away'] as const) {
    for (const d of DFS_SLOTS) {
      const slug = squads[side][d.slot] ?? null;
      if (!slug) continue;   // an empty slot is a zero — applyBullseye penalises the missing row
      const score = Math.round(pointsOf(slug, d.slot) * 10) / 10;
      sideTotal[side] += score;
      rows.push({ win: 'wk', side, slot: d.slot, slug, metric: null, score });
    }
  }
  const raw: ClassicResult = {
    home: sideTotal.home, away: sideTotal.away, slots: rows,
    states: [{ window: 'wk', home: sideTotal.home, away: sideTotal.away }],
  };
  return applyBullseye(raw, { cfg, card }, DFS_SLOTS.length);
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
