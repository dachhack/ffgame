// COLLEGE PLAYERS (0365) — identity and positions, stated once for every host.
//
// A college player's slug is `c-<espn_id>`. The slug stays the storage key the
// whole app joins on, and ESPN keeps the athlete id when a player reaches the
// NFL, so this is the one id that survives graduation without a name match.
// `c-` followed by DIGITS ONLY is the rule: slugOf(full_name) never produces
// it, while a bare `c-` prefix would catch an NFL "C. Smith" (`c-smith`).
// The database states the same rule in league_pool.level's generated
// expression; scripts/check-college.mjs pins the two against each other.
import type { Pos } from '../types';

export type Level = 'nfl' | 'college';

const COLLEGE_SLUG = /^c-(\d+)$/;

export const collegeSlug = (espnId: string | number): string => {
  const id = String(espnId).trim();
  if (!/^\d+$/.test(id)) throw new Error(`not an ESPN athlete id: ${espnId}`);
  return `c-${id}`;
};

export const isCollegeSlug = (slug: string | null | undefined): boolean =>
  !!slug && COLLEGE_SLUG.test(slug);

/** The ESPN athlete id inside a college slug, or null for any other slug. */
export const collegeEspnId = (slug: string | null | undefined): string | null =>
  (slug && COLLEGE_SLUG.exec(slug)?.[1]) || null;

export const levelOf = (slug: string | null | undefined): Level =>
  isCollegeSlug(slug) ? 'college' : 'nfl';

// ESPN college roster position → our Pos. Measured on four 2026 rosters
// (ALA, FLA, 2, 61): CB DB DE DL DT EDGE LB S · C OL QB RB TE WR · LS P PK.
// Linemen, long snappers and unlabelled athletes (ATH) are not fantasy
// players and map to null, which the worker skips.
const COLLEGE_POS: Record<string, Pos> = {
  QB: 'QB', RB: 'RB', HB: 'RB', TB: 'RB', FB: 'FB', WR: 'WR', TE: 'TE',
  PK: 'K', K: 'K', P: 'P',
  DL: 'DL', DE: 'DL', DT: 'DL', NT: 'DL', EDGE: 'DL',
  LB: 'LB', ILB: 'LB', OLB: 'LB', MLB: 'LB',
  DB: 'DB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB',
};

export const collegePos = (espnAbbr: string | null | undefined): Pos | null =>
  (espnAbbr && COLLEGE_POS[espnAbbr.trim().toUpperCase()]) || null;

/** The positions a college_player row may carry (mirrors 0365's upsert filter). */
export const COLLEGE_POSITIONS: readonly Pos[] = ['QB', 'RB', 'WR', 'TE', 'K', 'P', 'FB', 'DL', 'LB', 'DB'];

/** What to print where a player's NFL team goes: a college player's school
 *  (0365 — his `team` stays blank on purpose, since school codes collide with
 *  NFL ones), everyone else's team. */
export const teamLabel = (p: { team: string; school?: string | null }): string =>
  p.school || p.team;

// ── Conference / tier / class, for eligibility rules (0383) ─────────────────
// A spot or a league can be limited to college players from certain
// conferences (or a tier: P4 / G5 / IND / FBS) or classes (1 = FR … 4 = SR+).
// slotAllows is synchronous, so the facts it needs are installed here by the
// host — leaguePool on the clients, college_meta_for on the worker.
// ── Names, for boards that only hold a slug (v0.556.4) ──────────────────────
// A college slug is an ESPN id, so prettifying it printed "C. 5105849". The
// host installs the league's names (leaguePool does, from league_pool) and a
// board asks here first. Unknown slug → null, and the caller falls back.
const COLLEGE_NAMES = new Map<string, { full: string; school: string | null }>();
export function setCollegeNames(rows: { slug: string; full?: string | null; full_name?: string | null; school?: string | null }[]): void {
  for (const r of rows) {
    const full = r.full ?? r.full_name;
    if (isCollegeSlug(r.slug) && full) COLLEGE_NAMES.set(r.slug, { full, school: r.school ?? COLLEGE_NAMES.get(r.slug)?.school ?? null });
  }
}
export const collegeNameFor = (slug: string | null | undefined): { full: string; school: string | null } | null =>
  (slug ? COLLEGE_NAMES.get(slug) ?? null : null);

/** The team a board matches a player's GAME by. A college player carries no
 *  NFL team (school codes collide with NFL ones — Miami, Houston), so on a
 *  college-calendar week (board week 201+, whose slate holds only college
 *  games) his school stands in; anywhere else, his team as before. */
export const boardTeamFor = (slug: string, team: string | null | undefined, week: number | null | undefined): string =>
  (isCollegeSlug(slug) && (week ?? 0) > 200 ? collegeNameFor(slug)?.school ?? team ?? '' : team ?? '');

export type CollegeMeta = { conf?: string | null; tier?: string | null; cls?: number | null };
const COLLEGE_META = new Map<string, CollegeMeta>();
/** Merge (not replace): several leagues' pools may be installed in one session. */
export function setCollegeMeta(rows: Record<string, CollegeMeta> | { slug: string; conf?: string | null; tier?: string | null; cls?: number | null }[]): void {
  const list = Array.isArray(rows) ? rows.map((r) => [r.slug, r] as const) : Object.entries(rows);
  for (const [slug, m] of list) if (isCollegeSlug(slug)) COLLEGE_META.set(slug, { conf: m.conf ?? null, tier: m.tier ?? null, cls: m.cls ?? null });
}
export const collegeMetaFor = (slug: string | null | undefined): CollegeMeta | null => (slug ? COLLEGE_META.get(slug) ?? null : null);

/** The values a conference rule may name. 'FBS' is every FBS school. */
export const COLLEGE_TIERS = ['FBS', 'P4', 'G5', 'IND'] as const;
export const COLLEGE_CONFERENCES = ['ACC', 'Big 12', 'Big Ten', 'SEC', 'American', 'C-USA', 'MAC', 'Mountain West', 'Pac-12', 'Sun Belt', 'Independent'] as const;
export const collegeClassLabel = (c: number): string => (c <= 1 ? 'FR' : c === 2 ? 'SO' : c === 3 ? 'JR' : 'SR+');

/** Does a college player pass a conference / class rule? No facts, no pass —
 *  the no-guess rule every other filter follows. Empty lists pass everyone. */
export function collegeRuleAllows(m: CollegeMeta | null, confs?: string[] | null, classes?: number[] | null): boolean {
  if (confs?.length) {
    if (!m || !(m.conf || m.tier)) return false;
    const ok = confs.some((c) => c === 'FBS' ? !!m.tier : c === m.tier || c === m.conf);
    if (!ok) return false;
  }
  if (classes?.length) {
    if (m?.cls == null) return false;
    if (!classes.includes(Math.min(4, Math.max(1, m.cls)))) return false;
  }
  return true;
}
