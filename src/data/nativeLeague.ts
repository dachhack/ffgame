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

export interface DraftPoolEntry { slug: string; full: string; pos: string; team: string; }

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

/** The 2025 baked-PBP pool — offline fallback only (no rookies, 2025 teams). */
function bakedPool2025(): DraftPoolEntry[] {
  const ppr = pprBySlug();
  const rows: (DraftPoolEntry & { score: number })[] = [];
  for (const [slug, meta] of Object.entries(BAKED_SLUGS)) {
    const st = ppr.get(slug);
    rows.push({
      slug, full: titleFromSlug(slug), pos: meta.pos, team: meta.team,
      score: ADP_2026.get(slug) ?? (st != null ? VET_BASE + Math.max(0, 350 - st) : BENCH_BASE),
    });
  }
  rows.push(...kdstEntries());
  rows.sort((a, b) => a.score - b.score || a.slug.localeCompare(b.slug));
  return rows.map(({ score: _score, ...r }) => r);
}

export async function buildDraftPool(onProgress?: (note: string) => void): Promise<DraftPoolEntry[]> {
  let dir: Awaited<ReturnType<typeof loadPlayerDirectory>>;
  try {
    dir = await loadPlayerDirectory(onProgress);
  } catch {
    onProgress?.('Player directory unavailable — using the 2025 baked pool.');
    return bakedPool2025();
  }

  const ppr = pprBySlug();
  const best = new Map<string, DraftPoolEntry & { score: number }>();
  for (const p of dir.values()) {
    if (!POOL_POS.has(p.pos)) continue;                    // K/DST are team-keyed, added below
    const slug = slugFor(p.full);
    if (!slug) continue;
    const adp = ADP_2026.get(slug);
    // No NFL team (unsigned FA / retired) → only keep if the draft market
    // prices them anyway (a July FA like an unsigned star will sign; a re-seed
    // before the draft picks up the team).
    if (!p.team && adp == null) continue;
    const st = ppr.get(slug);
    const score = adp
      ?? (st != null ? VET_BASE + Math.max(0, 350 - st) : undefined)
      ?? (p.rank != null ? BENCH_BASE + p.rank : FLOOR);
    const prev = best.get(slug);
    if (!prev || score < prev.score) {
      best.set(slug, { slug, full: p.full, pos: p.pos, team: p.team ?? 'FA', score });
    }
  }
  const rows = [...best.values(), ...kdstEntries()];
  rows.sort((a, b) => a.score - b.score || a.slug.localeCompare(b.slug));
  return rows.slice(0, POOL_CAP).map(({ score: _score, ...r }) => r);
}
