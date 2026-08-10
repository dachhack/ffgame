// Synthetic K/DST fill for leagues that don't roster kickers and/or team
// defenses — which otherwise leaves the K (Banker) and DEF (Suppress / Earn)
// metrics unplayable. K/DST are team-keyed slugs (`<team>-k` / `<team>-dst`) the
// engine scores from the same real baked/live plays as any other slug; slugMeta
// resolves each to its NFL team so a fill can be kept off a bye week.
//
// A league's commissioner picks the mode (set_kdst_mode): 'off' (do nothing),
// 'random' (a deterministic not-on-bye pick, re-rolled each week), or 'manual'
// (a season-long per-team assignment, auto-substituted on the assigned team's bye
// week). The fill is injected into sleeper_lineup.starters_json at sync time, so
// the pool, the human picker, the AI auto-lineup, and the resolver all see it.
import { slugMeta } from './slugMeta';
import { windowForTeam, hasSlate } from './nflSlate';

// The 32 NFL team codes that carry baked K + DST play-by-play (slug prefixes).
export const NFL_CODES = [
  'ari', 'atl', 'bal', 'buf', 'car', 'chi', 'cin', 'cle', 'dal', 'den', 'det',
  'gb', 'hou', 'ind', 'jax', 'kc', 'la', 'lac', 'lv', 'mia', 'min', 'ne', 'no',
  'nyg', 'nyj', 'phi', 'pit', 'sea', 'sf', 'tb', 'ten', 'was',
];

export type KdstMode = 'off' | 'random' | 'manual';

/** Deterministic 32-bit hash (FNV-1a) — no Math.random, so a re-sync is stable. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** `<team>-<suffix>` slugs whose NFL team actually plays in `week` (not on bye),
 *  excluding any team already used in this assignment (K and DST never share one). */
function playingSlugs(week: number, suffix: 'k' | 'dst', exclude: Set<string>): string[] {
  const out: string[] = [];
  for (const code of NFL_CODES) {
    const slug = `${code}-${suffix}`;
    const team = slugMeta(slug).team;
    if (exclude.has(team)) continue;
    if (windowForTeam(week, team) !== null) out.push(slug);
  }
  return out;
}

export interface KdstFill { kSlug?: string; dstSlug?: string }
export interface KdstManual { k_slug?: string | null; dst_slug?: string | null }

/** Resolve a roster's K/DST fill for one week. Returns {} when the mode is 'off',
 *  there's no slate to bye-gate against, or nothing is needed. K and DST are
 *  always drawn from different NFL teams.
 *
 *  `taken` (random mode only): a league-wide set of NFL teams already handed out
 *  this week. When provided it's used AND mutated, so a league's random fills are
 *  drawn WITHOUT REPLACEMENT — no two fantasy teams share an NFL K or DEF. Manual
 *  mode ignores it (a commissioner may intentionally double up). */
export function assignKdst(opts: {
  leagueId: string; rosterId: number; week: number; mode: KdstMode;
  needK: boolean; needDef: boolean; manual?: KdstManual | null; taken?: Set<string>;
}): KdstFill {
  const { leagueId, rosterId, week, mode, needK, needDef } = opts;
  if (mode === 'off' || !hasSlate(week) || (!needK && !needDef)) return {};
  // Reuse the caller's league-wide set for random (without-replacement); manual gets
  // a fresh per-team set so duplicates across teams are allowed.
  const used = (mode === 'random' && opts.taken) ? opts.taken : new Set<string>();
  const out: KdstFill = {};

  const pick = (suffix: 'k' | 'dst', manualSlug?: string | null): string | undefined => {
    // Manual: honor the assignment unless its team is on bye this week → substitute.
    if (mode === 'manual' && manualSlug) {
      const team = slugMeta(manualSlug).team;
      if (!used.has(team) && windowForTeam(week, team) !== null) { used.add(team); return manualSlug; }
    }
    const pool = playingSlugs(week, suffix, used);
    if (!pool.length) return undefined;
    const slug = pool[hashStr(`${leagueId}|${rosterId}|${week}|${suffix}`) % pool.length];
    used.add(slugMeta(slug).team);
    return slug;
  };

  if (needK) out.kSlug = pick('k', opts.manual?.k_slug);
  if (needDef) out.dstSlug = pick('dst', opts.manual?.dst_slug);
  return out;
}
