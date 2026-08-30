// Native leagues (migration 0064): the draftable player universe.
//
// The pool is built for the CURRENT (2026) season from the full Sleeper player
// directory — which includes the 2026 rookie class with post-draft NFL teams —
// ranked in four tiers:
//   1. 2026 consensus ADP (adp2026.ts, baked from the Stathead MCP) — the real
//      draft market, rookies included at market price.
//   2. Team K/DST units, slotted at their real-world late-round cost.
//   3. Veterans outside the ADP top-200, ordered by 2025 production (ppr).
//   4. Everyone else (deep bench + deep rookies), ordered by Sleeper's
//      search_rank relevance signal.
// Every entry uses the engine slug convention (normName-hyphenated; team-keyed
// K/DST), the same key the worker's live-scoring index derives from this very
// directory — so anything draftable scores live in 2026, rookies included.
// (Rookies show as genuine DNPs on the baked-2025 replay boards.)
//
// If the ~15MB directory fetch fails, we fall back to the 2025 baked-PBP set so
// league creation never hard-fails offline.
import { BAKED_SLUGS } from './bakedSlugs';
import { STAT_PLAYERS, normName } from './players';
import { NFL_CODES } from './kdst';
import { ADP_2026 } from './adp2026';
import { loadPlayerDirectory, type PlayerMeta } from './sleeperPlayers';
import { teamFor } from './playerTeam';

export interface DraftPoolEntry {
  slug: string; full: string; pos: string; team: string; espnId?: string; exp?: number;
  /** The Sleeper player id — the STABLE identity (0205). Absent for the team
   *  pseudo-players (`den-k`, `den-dst`, `den-hc`, `den-p`), which are not
   *  people and have no Sleeper row. */
  sleeperId?: string;
}

const POOL_POS = new Set(['QB', 'RB', 'WR', 'TE']);
const POOL_CAP = 1200;      // server accepts 2000; keep the board browsable
// Tier anchors (ascending score = earlier rank). ADP occupies ~2–211.
const DST_BASE = 175;       // late-round territory, like real drafts
const K_BASE = 183;
const VET_BASE = 260;       // post-ADP veterans, by 2025 ppr
const BENCH_BASE = 1000;    // search_rank tier
const FLOOR = 100000;       // no signal at all

const slugFor = (full: string) => normName(full).replace(/\s+/g, '-');

/** Fallback display name for a baked slug outside the stats DB ("dj-moore" → "Dj Moore"). */
function titleFromSlug(slug: string): string {
  return slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

/** 2025 season ppr by engine slug (ranking signal for tier 3). */
function pprBySlug(): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of STAT_PLAYERS) {
    const slug = slugFor(p.name);
    if ((m.get(slug) ?? -1) < p.ppr) m.set(slug, p.ppr);
  }
  return m;
}

function kdstEntries(): (DraftPoolEntry & { score: number })[] {
  const out: (DraftPoolEntry & { score: number })[] = [];
  NFL_CODES.forEach((code, i) => {
    const t = code.toUpperCase();
    out.push({ slug: `${code}-dst`, full: `${t} Defense`, pos: 'DEF', team: t, score: DST_BASE + i * 0.01 });
    out.push({ slug: `${code}-k`, full: `${t} Kicker`, pos: 'K', team: t, score: K_BASE + i * 0.01 });
  });
  return out;
}

/** The 2025 baked-PBP pool — offline fallback only (no rookies). Teams go
 *  through the live layer (fresh bio bake + worker overrides), so even the
 *  fallback shows current teams for anyone the directory knows. */
function bakedPool2025(): DraftPoolEntry[] {
  const ppr = pprBySlug();
  const rows: (DraftPoolEntry & { score: number })[] = [];
  for (const [slug, meta] of Object.entries(BAKED_SLUGS)) {
    const st = ppr.get(slug);
    rows.push({
      slug, full: titleFromSlug(slug), pos: meta.pos, team: teamFor(slug) ?? meta.team,
      score: ADP_2026.get(slug) ?? (st != null ? VET_BASE + Math.max(0, 350 - st) : BENCH_BASE),
    });
  }
  rows.push(...kdstEntries());
  rows.sort((a, b) => a.score - b.score || a.slug.localeCompare(b.slug));
  disambiguateSlugs(rows);
  return rows.map(({ score: _score, ...r }) => r);
}

/** 0171: extra position groups + allowable-player filters, both decided at
 *  SEED time — league_pool is the gate every downstream surface (draft,
 *  waivers, lineups) already honors, so nothing else needs to know. */
export interface PoolOpts {
  /** Admin-enabled extras for this league: subset of IDP / FB / HC / P.
   *  (RET is a lineup-slot identity — it needs no pool entries.) */
  positions?: string[] | null;
  /** Commissioner's allowable-player filter: team whitelist and/or a tenure
   *  window (years_exp — 0 = rookie). Pseudo-players (K/DST/HC/P) pass the
   *  tenure filter always; the team filter applies to them too. */
  filter?: { teams?: string[] | null; min_exp?: number | null; max_exp?: number | null } | null;
}

function hcPuntEntries(positions: string[]): (DraftPoolEntry & { score: number })[] {
  const out: (DraftPoolEntry & { score: number })[] = [];
  NFL_CODES.forEach((code, i) => {
    const t = code.toUpperCase();
    if (positions.includes('HC')) out.push({ slug: `${code}-hc`, full: `${t} Head Coach`, pos: 'HC', team: t, score: BENCH_BASE + 400 + i * 0.01 });
    if (positions.includes('P')) out.push({ slug: `${code}-p`, full: `${t} Punter`, pos: 'P', team: t, score: BENCH_BASE + 500 + i * 0.01 });
  });
  return out;
}

/** ── TWO PEOPLE, ONE NAME (0205) ──────────────────────────────────────────
 *  `league_pool` is keyed `(league_id, slug)` and the slug is a normalised
 *  name, so a duplicate name cannot be two rows. It used to be resolved by
 *  DROPPING one — `byron-young` is Byron Young the Rams linebacker (81.2
 *  projected points) and Byron Young the Eagles lineman (36.0), and a
 *  commissioner could only ever roster one of them, with nothing on screen to
 *  say why.
 *
 *  Now the loser is RENAMED. Callers pass rows already sorted best-first, so
 *  the higher-ranked player keeps the clean slug and the other takes
 *  `<slug>-<sleeperId>`: deterministic, stable across re-seeds (a Sleeper id
 *  does not change), and unique because the id is.
 *
 *  A renamed slug misses every baked lookup we own — PLAYER_BIO, ADP_2026,
 *  PROJ_2026 — which is survivable ONLY because the pool carries the truth for
 *  those: `setSlugMetaOverrides` hands the boards his position and team, and
 *  `league_pool.sleeper_id` now lets a projection find him. That is why the id
 *  had to land in the same migration.
 *
 *  MUTATES IN PLACE and returns the same array — the caller is building a pool
 *  and has no use for a copy. An entry with no id is left alone: a team
 *  pseudo-player is not a person, and its slug is unique by construction. */
export function disambiguateSlugs<T extends { slug: string; sleeperId?: string }>(rows: T[]): T[] {
  const taken = new Set<string>();
  for (const r of rows) {
    if (taken.has(r.slug) && r.sleeperId) r.slug = `${r.slug}-${r.sleeperId}`;
    taken.add(r.slug);
  }
  return rows;
}

export async function buildDraftPool(onProgress?: (note: string) => void, opts?: PoolOpts): Promise<DraftPoolEntry[]> {
  let dir: Awaited<ReturnType<typeof loadPlayerDirectory>>;
  try {
    dir = await loadPlayerDirectory(onProgress);
  } catch {
    onProgress?.('Player directory unavailable — using the 2025 baked pool.');
    return bakedPool2025();
  }

  const extras = opts?.positions ?? [];
  const wantIdp = extras.includes('IDP');
  const wantFb = extras.includes('FB');
  const teams = opts?.filter?.teams?.length ? new Set(opts.filter.teams.map((t) => t.toUpperCase())) : null;
  const minExp = opts?.filter?.min_exp ?? null;
  const maxExp = opts?.filter?.max_exp ?? null;
  const tenureOk = (exp?: number) => {
    if (minExp == null && maxExp == null) return true;
    if (exp == null) return false; // unknown tenure can't prove eligibility
    return (minExp == null || exp >= minExp) && (maxExp == null || exp <= maxExp);
  };

  const ppr = pprBySlug();
  const best = new Map<string, DraftPoolEntry & { score: number; srank?: number }>();
  for (const p of dir.values()) {
    // Retired / out-of-the-league players never belong in a pool. Without this
    // an inactive NAME-TWIN of a ranked player inherits his slug-keyed ADP
    // below, sails past the no-team filter, TIES his score — and stable sort
    // then let directory order decide who keeps the clean slug. That is how
    // "Kenneth Walker" (a retired WR, no team) beat Kenneth Walker III to
    // `kenneth-walker` and drafted as WR · FA with a permanent BYE card.
    if (p.active === false) continue;
    const isIdp = p.pos === 'DL' || p.pos === 'LB' || p.pos === 'DB';
    if (isIdp && !wantIdp) continue;
    if (p.pos === 'FB' && !wantFb) continue;
    if (!isIdp && p.pos !== 'FB' && !POOL_POS.has(p.pos)) continue; // K/DST are team-keyed, added below
    const slug = slugFor(p.full);
    if (!slug) continue;
    if (teams && (!p.team || !teams.has(p.team.toUpperCase()))) continue;
    if (!tenureOk(p.exp)) continue;
    const adp = ADP_2026.get(slug);
    // No NFL team (unsigned FA / retired) → only keep if the draft market
    // prices them anyway (a July FA like an unsigned star will sign; a re-seed
    // before the draft picks up the team).
    if (!p.team && adp == null) continue;
    // Defenders/FBs have no ADP — rank by Sleeper search_rank in their own tier.
    const st = ppr.get(slug);
    const score = (isIdp || p.pos === 'FB')
      ? (p.rank != null ? BENCH_BASE + 100 + p.rank * 0.1 : FLOOR)
      : adp
        ?? (st != null ? VET_BASE + Math.max(0, 350 - st) : undefined)
        ?? (p.rank != null ? BENCH_BASE + p.rank : FLOOR);
    // KEYED BY THE SLEEPER ID, NOT THE SLUG (0205). This map used to be keyed by
    // slug, which meant two different active players with the same name were
    // one entry and the worse-scoring one VANISHED — `byron-young` is Byron
    // Young the Rams linebacker (81.2 projected points) and Byron Young the
    // Eagles lineman (36.0), and a commissioner could only ever roster one.
    // The identity is the id; the slug is a label that happens to collide.
    const prev = best.get(p.id);
    if (!prev || score < prev.score) {
      // espnId rides along so the draft board / team screens can render
      // headshots for players outside the baked 2025 map (i.e. rookies).
      // exp (0172) rides along too — league_pool stores it so per-slot tenure
      // filters can check eligibility at lineup time.
      best.set(p.id, { slug, full: p.full, pos: p.pos, team: p.team ?? 'FA', espnId: p.espnId, exp: p.exp, sleeperId: p.id, score, srank: p.rank });
    }
  }
  // K / D-ST / HC / P are TEAM-KEYED pseudo-players: one per NFL club, with no
  // person behind them and so no tenure at all. That made them invisible to the
  // tenure filter and they sailed into every pool — the founder's "the rookie
  // filter is picking up kickers and def". A tenure window is a statement about
  // PEOPLE; an entry that cannot answer it does not belong in the answer, which
  // is the same rule `tenureOk` already applies to a player whose experience
  // Sleeper doesn't know. So: a filtered pool drops them, an unfiltered one
  // keeps them all.
  const tenureFiltered = minExp != null || maxExp != null;
  const pseudo = (tenureFiltered ? [] : [...kdstEntries(), ...hcPuntEntries(extras)])
    .filter((e) => !teams || teams.has(e.team.toUpperCase()));
  const rows: (DraftPoolEntry & { score: number; srank?: number })[] = [...best.values(), ...pseudo];
  // search_rank breaks score TIES before the slug does: two active name-twins
  // share a slug-keyed ADP, and the one Sleeper considers relevant must rank
  // first — sorted-best-first is what disambiguateSlugs uses to decide who
  // keeps the clean slug (and with it every slug-keyed bake).
  rows.sort((a, b) => a.score - b.score || (a.srank ?? Infinity) - (b.srank ?? Infinity) || a.slug.localeCompare(b.slug));
  // Extras widen the universe — let the pool grow to the server's ceiling.
  const cap = extras.length ? 2000 : POOL_CAP;
  // THE CALL 0205 WAS BUILT FOR, which only the baked FALLBACK ever made
  // (v0.376.2's ghost hunt found it missing here): without it, two same-name
  // directory players reach seed_league_pool under ONE slug and the server's
  // `on conflict do nothing` silently drops whichever sorted second — for
  // Kenneth Walker that was the actual RB, beaten to the clean slug by his
  // retired WR name-twin. After the slice, so a renamed row can't be one the
  // cap was about to discard anyway.
  return disambiguateSlugs(rows.slice(0, cap).map(({ score: _score, srank: _srank, ...r }) => r));
}

/** ── THE POOL DOCTOR (v0.376.3) ───────────────────────────────────────────
 *  A pool seeded before the inactive filter (v0.376.2) can hold a GHOST: a
 *  row whose sleeper_id belongs to a retired player who inherited an active
 *  name-twin's slug — "Kenneth Walker · WR · FA", drafted as if he were the
 *  RB, wearing a permanent BYE. The twin himself is usually GONE (the missing
 *  disambiguation above meant `on conflict do nothing` ate him), so the fix
 *  is not a swap but a rewrite: put the ACTIVE same-slug directory player's
 *  identity onto the row the rosters already reference.
 *
 *  SQL cannot know who is retired — the directory can. So diagnosis is
 *  client-side and pure: given the pool and the directory, return the rewrite
 *  for every ghost that has exactly one obvious living owner of its slug.
 *  A ghost with no active same-slug player (truly retired, no twin) is
 *  reported, not guessed at. Team pseudo-players (no sleeper_id) are skipped. */
export interface PoolGhostFix {
  slug: string;
  was: { full: string; pos: string; team: string };
  fix: DraftPoolEntry;                                  // the identity to write
}
export function diagnosePoolGhosts(
  pool: { slug: string; full_name: string; pos: string; team: string; sleeper_id?: string | null }[],
  dir: Map<string, PlayerMeta>,
): { fixes: PoolGhostFix[]; unfixable: { slug: string; full: string }[] } {
  // slug → active directory players, best search_rank first.
  const bySlug = new Map<string, PlayerMeta[]>();
  for (const p of dir.values()) {
    if (p.active === false) continue;
    const s = slugFor(p.full);
    if (!s) continue;
    const arr = bySlug.get(s);
    if (arr) arr.push(p); else bySlug.set(s, [p]);
  }
  for (const arr of bySlug.values()) arr.sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));

  const inPool = new Set(pool.map((r) => r.sleeper_id).filter(Boolean) as string[]);
  const fixes: PoolGhostFix[] = [];
  const unfixable: { slug: string; full: string }[] = [];
  for (const row of pool) {
    if (!row.sleeper_id) continue;                       // team pseudo-players
    const meta = dir.get(row.sleeper_id);
    if (!meta || meta.active !== false) continue;        // not a ghost
    const live = (bySlug.get(row.slug) ?? []).find((p) => !inPool.has(p.id));
    if (!live) { unfixable.push({ slug: row.slug, full: row.full_name }); continue; }
    inPool.add(live.id);
    fixes.push({
      slug: row.slug,
      was: { full: row.full_name, pos: row.pos, team: row.team },
      fix: { slug: row.slug, full: live.full, pos: live.pos, team: live.team ?? 'FA', espnId: live.espnId, exp: live.exp, sleeperId: live.id },
    });
  }
  return { fixes, unfixable };
}
