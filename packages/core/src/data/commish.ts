// Commissioner kit (0141), client side: the league note and player flags.
//
// The flags follow the injuries pattern: a synchronous module cache behind
// flagFor(), because the render paths that show flags (pool rows, pickers,
// the player card) are deep component trees that cannot await. The host loads
// the current league's flags into the cache and bumps a version counter in
// its store/state so the tree re-renders — same contract as setLiveInjuries.
//
// One league at a time, deliberately: a board only ever shows one league, and
// swapping leagues swaps the cache wholesale (or clears it on exit).

export interface LeagueNote { text: string | null; at: string | null; canEdit: boolean; }

/** A flag's RULES (0144, docs/flag-rules.md) — parsed from the stored snake
 *  keys once at install so the engine's per-play reads are cheap. */
export interface FlagRules {
  noTrade?: boolean; noAdd?: boolean; noStart?: boolean; noPowerups?: boolean; immune?: boolean;
  bonusMult?: number; bonusPts?: number;
}
const EMPTY_RULES: FlagRules = {};

function parseRules(raw: unknown): FlagRules {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: FlagRules = {};
  if (o.no_trade === true) out.noTrade = true;
  if (o.no_add === true) out.noAdd = true;
  if (o.no_start === true) out.noStart = true;
  if (o.no_powerups === true) out.noPowerups = true;
  if (o.immune === true) out.immune = true;
  const m = Number(o.bonus_mult);
  if (Number.isFinite(m) && m !== 1) out.bonusMult = Math.min(3, Math.max(0.5, Math.round(m * 10) / 10));
  const b = Number(o.bonus_pts);
  if (Number.isFinite(b) && b !== 0) out.bonusPts = Math.min(10, Math.max(-10, Math.round(b * 10) / 10));
  return out;
}

let flagLeague: string | null = null;
let flags = new Map<string, { label: string; rules: FlagRules }>();

/** Replace the cache with LEAGUE's flags. */
export function setLeagueFlags(leagueId: string, rows: { slug: string; label: string; rules?: unknown }[]): void {
  flagLeague = leagueId;
  flags = new Map(rows.map((r) => [r.slug, { label: r.label, rules: parseRules(r.rules) }]));
}

export function clearLeagueFlags(): void {
  flagLeague = null;
  flags = new Map();
}

/** The commissioner's label on this player, if any. Synchronous — render
 *  paths and the player card call it directly. */
export function flagFor(slug: string): string | null {
  return flags.get(slug)?.label ?? null;
}

/** The flag's rules — always an object, empty when unflagged, so engine
 *  call sites read `flagRulesFor(slug).immune` without null checks. */
export function flagRulesFor(slug: string): FlagRules {
  return flags.get(slug)?.rules ?? EMPTY_RULES;
}

/** Which league the cache currently speaks for (null = empty). */
export function flagsLeague(): string | null {
  return flagLeague;
}

// ── THE COMMISSIONER'S POINT ADJUSTMENTS (0355) ─────────────────────────────
// Points added to or taken off ONE player in ONE week, by the commissioner, for
// a stat the feed got wrong. The same module-cache contract as the flags above,
// and read in the same place — classicPoints — so the worker's resolve and both
// boards cannot disagree about what a corrected week was worth. Keyed by week
// as well as slug: a correction to week 3 is not a standing bonus.
//
// One league at a time, and installed EMPTY for a league with none: a board
// that clears it on exit leaves nothing behind for the next league to inherit.
let adjLeague: string | null = null;
let adjustments = new Map<string, number>();
const adjKey = (week: number, slug: string) => `${week}|${slug}`;

export function setLeagueAdjustments(leagueId: string, rows: { week: number; slug: string; points: number | string }[]): void {
  adjLeague = leagueId;
  adjustments = new Map();
  for (const r of rows) {
    const p = Math.round(Number(r.points) * 10) / 10;
    if (Number.isFinite(p) && p !== 0) adjustments.set(adjKey(Number(r.week), r.slug), p);
  }
}

export function clearLeagueAdjustments(): void {
  adjLeague = null;
  adjustments = new Map();
}

/** The commissioner's adjustment to this player's week, 0 when none. */
export function adjustmentFor(slug: string, week: number): number {
  return adjustments.get(adjKey(week, slug)) ?? 0;
}

/** Which league the adjustment cache speaks for (null = empty). */
export function adjustmentsLeague(): string | null {
  return adjLeague;
}
