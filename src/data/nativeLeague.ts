// Native leagues (migration 0064): the draftable player universe.
//
// A native league's pool is deliberately the BAKED-PBP player set — every skill
// player with real play-by-play (BAKED_SLUGS) plus the 32 team K/DST units — so
// every draftable player actually scores in the engine. Ranked by real 2025
// production (fantasy_points_ppr from the stats DB), with K/DST deflated to
// land in the late rounds where drafters expect them. The ranked list is sent
// once to `seed_league_pool`; the server's autopick and the draft board both
// order by this rank.
import { BAKED_SLUGS } from './bakedSlugs';
import { STAT_PLAYERS, normName } from './players';
import { NFL_CODES } from './kdst';

export interface DraftPoolEntry { slug: string; full: string; pos: string; team: string; }

/** Fallback display name for a baked slug outside the stats DB ("dj-moore" → "Dj Moore"). */
function titleFromSlug(slug: string): string {
  return slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

// Deep-bench players with no stats row still belong in the pool (they have real
// PBP) — they just rank below everyone who produced.
const BENCH_SCORE = 10;
const K_SCORE = 60;   // late-round territory: below every startable skill player,
const DST_SCORE = 55; // above the true deep bench.

export function buildDraftPool(): DraftPoolEntry[] {
  const bySlug = new Map<string, { name: string; ppr: number }>();
  for (const p of STAT_PLAYERS) {
    const slug = normName(p.name).replace(/\s+/g, '-');
    const prev = bySlug.get(slug);
    if (!prev || p.ppr > prev.ppr) bySlug.set(slug, { name: p.name, ppr: p.ppr });
  }
  const rows: (DraftPoolEntry & { score: number })[] = [];
  for (const [slug, meta] of Object.entries(BAKED_SLUGS)) {
    const st = bySlug.get(slug);
    rows.push({
      slug, full: st?.name ?? titleFromSlug(slug), pos: meta.pos, team: meta.team,
      score: st?.ppr ?? BENCH_SCORE,
    });
  }
  for (const code of NFL_CODES) {
    const t = code.toUpperCase();
    rows.push({ slug: `${code}-k`, full: `${t} Kicker`, pos: 'K', team: t, score: K_SCORE });
    rows.push({ slug: `${code}-dst`, full: `${t} Defense`, pos: 'DEF', team: t, score: DST_SCORE });
  }
  rows.sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));
  return rows.map(({ score: _score, ...r }) => r);
}
