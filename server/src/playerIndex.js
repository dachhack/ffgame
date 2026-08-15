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

/** Build an index from the Sleeper player directory.
 *
 *  Slugs are UNIQUE per player (0200): entries are grouped by their
 *  name-derived slug; each group's PRIMARY (best slugRank) keeps the clean
 *  slug — which is what every stored pick/roster/bake already means by it —
 *  and every namesake/duplicate gets a deterministic suffixed slug
 *  (`josh-allen-lb`, or `-<sleeperId>` when the position doesn't
 *  disambiguate). byEspnId maps each ESPN id to ITS OWN player's slug, so
 *  id-resolved feed plays can never land in a namesake's timeline. */
export async function buildPlayerIndex(directory) {
  const players = directory ?? await getPlayers(); // injectable for tests
  const entries = [];
  for (const [sid, p] of Object.entries(players)) {
    const full = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
    if (!full) continue;
    entries.push({ sid, p, full, base: slugOf(full), rank: slugRank(p) });
  }
  const groups = new Map(); // base slug -> entries sharing it
  for (const e of entries) {
    if (!groups.has(e.base)) groups.set(e.base, []);
    groups.get(e.base).push(e);
  }
  const byEspnId = new Map(); // "12345" -> that player's own minted slug
  const byName = new Map();   // normName(full) -> the PRIMARY holder's slug
  const bySleeperId = new Map(); // sleeper player_id -> { slug, full, pos, team, espnId }
  const bySlug = new Map();    // minted slug -> { full, pos, team } (engine Player objects)
  const nameBest = new Map();  // normName -> best rank seen
  let collisions = 0;
  for (const [base, g] of groups) {
    // Deterministic primary: rank, then sleeper id as a stable tiebreak.
    g.sort((a, b) => a.rank - b.rank || String(a.sid).localeCompare(String(b.sid)));
    const used = new Set();
    for (let i = 0; i < g.length; i++) {
      const e = g[i];
      let slug = base;
      if (i > 0) {
        collisions++;
        const posSfx = e.p.position ? `${base}-${String(e.p.position).toLowerCase()}` : null;
        slug = posSfx && !used.has(posSfx) ? posSfx : `${base}-${e.sid}`;
      }
      used.add(slug);
      bySleeperId.set(e.sid, { slug, full: e.full, pos: e.p.position, team: e.p.team, espnId: e.p.espn_id ? String(e.p.espn_id) : null });
      if (e.p.espn_id) byEspnId.set(String(e.p.espn_id), slug);
      bySlug.set(slug, { full: e.full, pos: e.p.position, team: e.p.team, sid: e.sid });
      const nk = normName(e.full);
      if (!nameBest.has(nk) || e.rank < nameBest.get(nk)) { nameBest.set(nk, e.rank); byName.set(nk, slug); }
    }
  }
  console.log(new Date().toISOString(), `player index: ${bySleeperId.size} players, ${collisions} colliding slugs disambiguated`);
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
