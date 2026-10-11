// CONTEST LEAGUES (v0.664.0) — docs/dfs-bullseye.md §13. A salary-cap league
// whose squads are rebuilt every week from the board and scored one of three
// ways: HIGH (most points), GOLF (fewest — the classic golf rule, a spot's
// zero_pts pricing a scoreless spot), BULLSEYE (closest to the week's card —
// classic Bullseye's dart, dfsBullseye.ts's week). The squad's shape is the
// league's own roster builder spots (classic.ts), so a FLEX, an HC or a
// rookie-only RB spot is just another spot; the card is dealt over them and
// the league's catalog prices each player. Pure: the worker scores with it,
// both clients preview with it, the probe checks it.
import { applyBullseye, bullseyeConfigOf, dealBullseyeCard, type BullseyeCard, type BullseyeConfig } from './bullseye';
import { leagueSlotDefs, slotAllows, slotDisplayName, isRetSlot, type ClassicResult, type ClassicSlotDef, type ClassicSlotScore, type SlotSpec } from './classic';
import { tiebreakDistance, type BoardPlayer } from './dfsBullseye';

export type ContestKind = 'high' | 'golf' | 'bullseye';
export type ContestFormat = 'h2h' | 'board';
export const CONTEST_MIN_SALARY = 3000;
export const CONTEST_BUDGET_DEFAULT = 50000;

export interface ContestConfig {
  contest: ContestKind;
  format: ContestFormat;
  budget: number;
  /** The league's spots, S1…Sn (leagueSlotDefs over roster_slots; the DFS nine by default). */
  slots: ClassicSlotDef[];
  /** The dart, for a Bullseye contest; null otherwise. Always a shared card. */
  bullseye: BullseyeConfig | null;
}

export const CONTEST_DEFAULT_SLOTS: SlotSpec[] = [
  { pos: ['QB'] }, { pos: ['RB'] }, { pos: ['RB'] }, { pos: ['WR'] }, { pos: ['WR'] }, { pos: ['WR'] }, { pos: ['TE'] }, { pos: ['K'] }, { pos: ['DEF'] },
];

/** The league's contest, from its settings — null for a league that isn't
 *  one. `kind` (league.kind) decides for a league whose settings predate the
 *  `contest` key. */
export function contestConfigOf(settings?: Record<string, unknown> | null, kind?: string | null): ContestConfig | null {
  const s = settings ?? {};
  const explicit = s.contest === 'high' || s.contest === 'golf' || s.contest === 'bullseye' ? s.contest as ContestKind : null;
  const legacy = s.dfs_bullseye === true ? 'bullseye' : kind === 'bullseye' ? 'bullseye' : kind === 'dfs' ? 'high' : null;
  const contest = explicit ?? legacy;
  if (!contest) return null;
  const format: ContestFormat = s.contest_format === 'h2h' || s.contest_format === 'board' ? s.contest_format : kind === 'bullseye' ? 'board' : 'h2h';
  const b = Number(s.budget);
  const budget = Number.isFinite(b) && b >= 10000 ? Math.round(b / 100) * 100 : CONTEST_BUDGET_DEFAULT;
  const spec = Array.isArray(s.roster_slots) && s.roster_slots.length ? s.roster_slots as SlotSpec[] : CONTEST_DEFAULT_SLOTS;
  const slots = leagueSlotDefs({ slots: spec });
  const bullseye = contest === 'bullseye'
    ? (bullseyeConfigOf({ bullseye: (s.bullseye as string) ?? 'slots', bullseye_radius: (s.bullseye_radius as number) ?? null }) ?? bullseyeConfigOf({ bullseye: 'slots' }))
    : null;
  return { contest, format, budget, slots, bullseye: bullseye ? { ...bullseye, deal: 'shared' } : null };
}

export const CONTEST_WORD: Record<ContestKind, string> = { high: 'HIGHEST SCORE', golf: 'GOLF · LOWEST SCORE', bullseye: 'BULLSEYE' };
export const CONTEST_FORMAT_WORD: Record<ContestFormat, string> = { h2h: 'HEAD-TO-HEAD', board: 'LEADERBOARD' };
export const CONTEST_EMOJI: Record<ContestKind, string> = { high: '🏆', golf: '⛳', bullseye: '🎯' };
/** What a squad scores, in a word: a Bullseye squad banks a RING, the others points. */
export const CONTEST_SCORE_WORD: Record<ContestKind, string> = { high: 'pts', golf: 'pts', bullseye: 'ring' };
/** Is this score better than that one, by the contest's own rule? */
export const contestBetter = (contest: ContestKind, a: number, b: number): boolean => (contest === 'golf' ? a < b : a > b);

/** What to call spot i on screen: the commissioner's label, else the type
 *  with a number where the type repeats (RB1, RB2 — the DFS names). */
export function contestSlotLabels(slots: ClassicSlotDef[]): Record<string, string> {
  const count = new Map<string, number>();
  for (const d of slots) if (!d.label) count.set(d.type, (count.get(d.type) ?? 0) + 1);
  const seen = new Map<string, number>();
  const out: Record<string, string> = {};
  for (const d of slots) {
    if (d.label) { out[d.slot] = d.label; continue; }
    const base = d.type === 'DEF' ? 'D/ST' : d.type;
    if ((count.get(d.type) ?? 0) > 1) { const n = (seen.get(d.type) ?? 0) + 1; seen.set(d.type, n); out[d.slot] = `${base}${n}`; }
    else out[d.slot] = base;
  }
  return out;
}
export const contestSlotName = (d: ClassicSlotDef): string => slotDisplayName({ label: d.label, pos: d.pos });

/** The week's card over the league's spots, seeded on (league, week) and
 *  anchored to the league's catalog: the worker, both clients and a probe
 *  deal the same numbers. */
export function contestCard(leagueId: string, week: number, slots: ClassicSlotDef[], catalog?: Parameters<typeof dealBullseyeCard>[3]): BullseyeCard {
  return dealBullseyeCard(leagueId, week, slots.map((d) => ({ slot: d.slot, type: d.type, pos: [...d.pos] })), catalog);
}

/** A stored squad (sleeper_lineup.starters_json) as spot → slug. Rows on the
 *  league's own spots (S1…) are read by name; a squad saved before 0466
 *  (DFS names, or the numbered slots of save_pod_entry and an AI build) fills
 *  the spots in order by position. */
export function contestSquadOf(starters: unknown, slots: ClassicSlotDef[]): Record<string, string | null> {
  const out: Record<string, string | null> = Object.fromEntries(slots.map((d) => [d.slot, null]));
  const rows = Array.isArray(starters) ? starters as { slot?: unknown; player_slug?: unknown; pos?: unknown; grp?: unknown }[] : [];
  const loose: { slug: string; pos: string }[] = [];
  for (const r of rows) {
    const slug = typeof r?.player_slug === 'string' && r.player_slug ? r.player_slug : null;
    if (!slug || r?.grp) continue;
    if (typeof r.slot === 'string' && r.slot in out) out[r.slot] = slug;
    else loose.push({ slug, pos: String(r.pos ?? '').toUpperCase() });
  }
  for (const p of loose) {
    const open = slots.find((d) => out[d.slot] == null && (d.pos as string[]).includes(p.pos));
    if (open) out[open.slot] = p.slug;
  }
  return out;
}

// ── THE TIE-BREAKER (v0.660.1), over the league's spots ────────────────────
// One RB or WR spot per seat (a spot that takes exactly that position), a
// number near its card target. A league with no such spot has no tie-break.
export interface ContestTiebreak { slot: string; target: number }
export function contestTiebreak(leagueId: string, week: number, rosterId: number, card: BullseyeCard, slots: ClassicSlotDef[]): ContestTiebreak | null {
  const pool = slots.filter((d) => d.pos.length === 1 && (d.pos[0] === 'RB' || d.pos[0] === 'WR'));
  if (!pool.length) return null;
  const r = mulberry(`tiebreak|${leagueId}|${week}|${rosterId}`);
  const d = pool[Math.floor(r() * pool.length) % pool.length];
  const mag = 1 + Math.floor(r() * 4);
  const sign = r() < 0.5 ? -1 : 1;
  const base = card.targets[d.slot] ?? 10;
  return { slot: d.slot, target: Math.max(3, base + sign * mag) };
}

/** Score a week's squads. `pointsOf` is the player's real points in that
 *  spot under the league's catalog (the worker: classicPoints). A SOLO row
 *  (a leaderboard seat is its own opponent) scores the same squad on both
 *  sides, which is what a board reading `home` wants. */
export function scoreContest(
  squads: { home: Record<string, string | null>; away: Record<string, string | null> },
  cfg: ContestConfig,
  pointsOf: (slug: string, slot: string, def: ClassicSlotDef) => number,
  opts: {
    /** SEALED (v0.660.1): a player whose game hasn't started — not written, not scored, not a zero yet. */
    pending?: (slug: string) => boolean;
    card?: BullseyeCard | null;
    tiebreak?: { home?: ContestTiebreak | null; away?: ContestTiebreak | null };
  } = {},
): ClassicResult & { tiebreak: { home: number | null; away: number | null } } {
  const pending = opts.pending ?? (() => false);
  const sideRows = { home: [] as ClassicSlotScore[], away: [] as ClassicSlotScore[] };
  const counted = { home: 0, away: 0 };
  const tb = { home: null as number | null, away: null as number | null };
  const radius = cfg.bullseye?.radius ?? 10;
  for (const side of ['home', 'away'] as const) {
    const t = opts.tiebreak?.[side] ?? null;
    let tbDone = false;
    for (const d of cfg.slots) {
      const slug = squads[side][d.slot] ?? null;
      if (slug && pending(slug)) continue;
      counted[side]++;
      let score = slug ? Math.round(pointsOf(slug, d.slot, d) * 10) / 10 : 0;
      // THE ZERO-FILL RULE (0200): a spot that scores nothing banks its
      // zero_pts — a penalty in golf, a floor in a high-score league. Not
      // under the dart, which prices a zero itself.
      if (cfg.contest !== 'bullseye' && d.zeroPts != null && Math.abs(score) < 1e-9) score = d.zeroPts;
      if (!slug && cfg.contest === 'bullseye') continue;   // an empty spot is a zero — the penalty finds the missing row
      sideRows[side].push({ win: 'wk', side, slot: d.slot, slug, metric: null, score });
      if (t && t.slot === d.slot) { tb[side] = tiebreakDistance(slug ? score : 0, t.target, radius); tbDone = true; }
    }
    if (t && !tbDone && !(squads[side][t.slot] && pending(squads[side][t.slot]!))) tb[side] = tiebreakDistance(0, t.target, radius);
  }
  if (cfg.contest !== 'bullseye' || !cfg.bullseye || !opts.card) {
    const sum = (rows: ClassicSlotScore[]) => Math.round(rows.reduce((s, r) => s + r.score, 0) * 10) / 10;
    const h = sum(sideRows.home), a = sum(sideRows.away);
    return { home: h, away: a, slots: [...sideRows.home, ...sideRows.away], states: [{ window: 'wk', home: h, away: a }], tiebreak: tb };
  }
  const bull = { cfg: cfg.bullseye, card: opts.card };
  const dartSide = (side: 'home' | 'away') => {
    const rows = sideRows[side].map((r) => ({ ...r, side: 'home' as const }));
    const pts = rows.reduce((s, r) => s + r.score, 0);
    const res = applyBullseye({ home: pts, away: 0, slots: rows, states: [{ window: 'wk', home: pts, away: 0 }] }, bull, Math.max(1, counted[side]));
    return { ring: res.home, rows: res.slots.filter((r) => r.side === 'home').map((r) => ({ ...r, side })), summary: res.bullseye?.home };
  };
  const h = dartSide('home'), a = dartSide('away');
  return {
    home: h.ring, away: a.ring, slots: [...h.rows, ...a.rows],
    states: [{ window: 'wk', home: h.ring, away: a.ring }],
    ...(h.summary && a.summary ? { bullseye: { variant: cfg.bullseye.variant, radius: cfg.bullseye.radius, home: h.summary, away: a.summary } } : {}),
    tiebreak: tb,
  };
}

/** May this board player stand in this spot? Position (RET spots take any
 *  ball-carrier), the spot's team/tenure/flag filter. The budget, the pool
 *  filter and the seat's rule are the caller's. */
export const contestSlotAllows = (d: ClassicSlotDef, p: { slug: string; pos: string; team?: string | null; exp?: number | null }): boolean =>
  slotAllows({ pos: d.pos, flt: d.flt }, { id: p.slug, pos: p.pos, team: p.team ?? null, exp: p.exp });

export interface ContestBoardPlayer extends BoardPlayer { exp?: number | null }

/** THE AUTO-BUILD — an AI seat, or a no-show at lock, in a head-to-head
 *  league. Spot by spot, the fewest-candidates spot first, always reserving
 *  the minimum salary per spot still to fill so it can never bust the
 *  budget. HIGH takes the biggest projection; GOLF the smallest that is
 *  still a real player (a zero is a no-show, and the zero-fill prices it);
 *  BULLSEYE the one landing closest to the spot's number. Seeded jitter keeps
 *  two seats from building alike. */
export function contestAutoBuild(board: ContestBoardPlayer[], cfg: ContestConfig, seed: string, card?: BullseyeCard | null): Record<string, string | null> {
  const rand = mulberry(seed);
  const out: Record<string, string | null> = Object.fromEntries(cfg.slots.map((d) => [d.slot, null]));
  const fits = (d: ClassicSlotDef) => board.filter((p) => contestSlotAllows(d, p));
  const order = [...cfg.slots].sort((a, b) => fits(a).length - fits(b).length);
  const jitter = new Map(board.map((p) => [p.slug, (rand() - 0.5) * 1.5]));
  const taken = new Set<string>();
  let budget = cfg.budget;
  order.forEach((d, i) => {
    const maxSpend = budget - (order.length - i - 1) * CONTEST_MIN_SALARY;
    const pool = fits(d).filter((p) => !taken.has(p.slug) && p.salary <= maxSpend);
    const j = (p: BoardPlayer) => p.proj + (jitter.get(p.slug) ?? 0);
    let pick: BoardPlayer | undefined;
    if (cfg.contest === 'bullseye' && card) {
      const target = card.targets[d.slot] ?? 0;
      pick = pool.filter((p) => p.proj > 0).sort((a, b) => Math.abs(j(a) - target) - Math.abs(j(b) - target) || a.salary - b.salary)[0];
    } else if (cfg.contest === 'golf') {
      pick = pool.filter((p) => p.proj > 0).sort((a, b) => j(a) - j(b) || a.salary - b.salary)[0];
    } else {
      pick = pool.sort((a, b) => j(b) - j(a) || a.salary - b.salary)[0];
    }
    if (!pick) return;
    taken.add(pick.slug);
    budget -= pick.salary;
    out[d.slot] = pick.slug;
  });
  return out;
}

/** Squad salary. */
export const contestSalary = (squad: Record<string, string | null>, salaryOf: (slug: string) => number): number =>
  Object.values(squad).reduce((s, slug) => s + (slug ? salaryOf(slug) : 0), 0);

/** The score-as position for a spot: a RET spot scores return work only. */
export const contestScoreAs = (d: ClassicSlotDef): string | undefined => (isRetSlot(d.pos) ? 'RET' : undefined);

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
