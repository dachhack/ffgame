// Player slug index built from Sleeper's directory. The slug is the SHARED key
// across plays, sealed picks, lineups, and injuries — derive it one way only.
//
// slug = slugOf(full_name) (normName-hyphenated, same as the baked contract). The
// directory also carries espn_id, which is the stable bridge for resolving ESPN
// feed athletes (boxscore ids / injury names) back to the same slug, sidestepping
// nickname drift ("Joshua" vs "Josh") and — where ids are present — initials
// collisions (the Etienne brothers).
import { slugOf, normName } from '../../scripts/espn/espnAdapter.mjs';
import { getPlayers } from './sleeper.js';

export { slugOf, normName };

// Collision policy for a SHARED slug (0199.4). slugOf(full_name) is the game's
// key, and the NFL reuses names: the Sleeper directory can hold a namesake or a
// stale duplicate for a star's slug — and first-write-wins here handed the
// ENGINE whichever entry iterated first. A "Josh Allen" with a defensive or
// null position claimed the QB's slug, makePlayer carried that position into
// resolveSlot, and the position-gated pass metric scored the QB's 111-yard day
// as 0 across every league while the clients (which never read this index)
// scored 8.4 — the 8/15 hunt's final layer. Rank: fantasy positions before
// IDP/null, then Sleeper's search_rank (lower = more prominent), so the player
// the pool means by that slug is the one the engine sees.
const FANTASY_POS = new Set(['QB', 'RB', 'WR', 'TE', 'K', 'DEF']);
const slugRank = (p) => {
  const sr = Number(p.search_rank);
  return (FANTASY_POS.has(p.position) ? 0 : 1e9) + (Number.isFinite(sr) ? sr : 1e8);
};

/** Build an index from the Sleeper player directory. */
export async function buildPlayerIndex() {
  const players = await getPlayers();
  const byEspnId = new Map(); // "12345" -> slug
  const byName = new Map();   // normName(full) -> slug
  const bySleeperId = new Map(); // sleeper player_id -> { slug, full, pos, team, espnId }
  const bySlug = new Map();    // slug -> { full, pos, team } (for engine Player objects)
  const slugBest = new Map();  // slug -> best rank seen (collision policy above)
  const nameBest = new Map();  // normName -> best rank seen (same policy)
  for (const [sid, p] of Object.entries(players)) {
    const full = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
    if (!full) continue;
    const slug = slugOf(full);
    const rank = slugRank(p);
    bySleeperId.set(sid, { slug, full, pos: p.position, team: p.team, espnId: p.espn_id ? String(p.espn_id) : null });
    if (p.espn_id) byEspnId.set(String(p.espn_id), slug);
    const nk = normName(full);
    if (!nameBest.has(nk) || rank < nameBest.get(nk)) { nameBest.set(nk, rank); byName.set(nk, slug); }
    if (!slugBest.has(slug) || rank < slugBest.get(slug)) { slugBest.set(slug, rank); bySlug.set(slug, { full, pos: p.position, team: p.team, sid }); }
  }
  return {
    slugForEspnId: (id) => (id != null ? byEspnId.get(String(id)) ?? null : null),
    slugForName: (name) => byName.get(normName(name)) ?? null,
    sleeper: (sid) => bySleeperId.get(String(sid)) ?? null,
    metaForSlug: (slug) => bySlug.get(slug) ?? null,
    /** Every indexed player as { slug, full, pos, team, sid } (pod dealing). */
    allSlugs: () => [...bySlug.entries()].map(([slug, m]) => ({ slug, ...m })),
    size: bySleeperId.size,
  };
}
