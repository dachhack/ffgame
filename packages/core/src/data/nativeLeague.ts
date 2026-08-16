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
import { loadPlayerDirectory } from './sleeperPlayers';
import { teamFor } from './playerTeam';

export interface DraftPoolEntry { slug: string; full: string; pos: string; team: string; espnId?: string; }

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
  const best = new Map<string, DraftPoolEntry & { score: number }>();
  for (const p of dir.values()) {
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
    const prev = best.get(slug);
    if (!prev || score < prev.score) {
      // espnId rides along so the draft board / team screens can render
      // headshots for players outside the baked 2025 map (i.e. rookies).
      best.set(slug, { slug, full: p.full, pos: p.pos, team: p.team ?? 'FA', espnId: p.espnId, score });
    }
  }
  const pseudo = [...kdstEntries(), ...hcPuntEntries(extras)]
    .filter((e) => !teams || teams.has(e.team.toUpperCase()));
  const rows = [...best.values(), ...pseudo];
  rows.sort((a, b) => a.score - b.score || a.slug.localeCompare(b.slug));
  // Extras widen the universe — let the pool grow to the server's ceiling.
  const cap = extras.length ? 2000 : POOL_CAP;
  return rows.slice(0, cap).map(({ score: _score, ...r }) => r);
}
