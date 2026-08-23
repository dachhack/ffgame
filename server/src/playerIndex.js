// Player slug index built from Sleeper's directory. The slug is the SHARED key
// across plays, sealed picks, lineups, and injuries — derive it one way only.
//
// slug = slugOf(full_name) (normName-hyphenated, same as the baked contract). The
// directory also carries espn_id, which is the stable bridge for resolving ESPN
// feed athletes (boxscore ids / injury names) back to the same slug, sidestepping
// nickname drift ("Joshua" vs "Josh") and — where ids are present — initials
// collisions (the Etienne brothers).
import { slugOf, normName } from '../../scripts/espn/espnAdapter.mjs';
import { normTeam } from '../../packages/core/src/data/slugMeta.ts';
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

// RESOLVING A NAME PREFERS THE LIVING (v0.345.0).
//
// `slugRank` decides which player OWNS a shared slug, and it must not change:
// stored picks, rosters and bakes already mean the historic holder by it.
// Resolving a NAME COMING OFF A FIELD is a different question with a different
// answer — who could plausibly have just made that play — and it was being
// answered by slugRank, which ranks fantasy position above being alive:
//
//   · DET DL Chris Smith's tackles resolved to a TEAMLESS RB namesake, because
//     RB is a fantasy position and DL is not.
//   · WAS rookie CB Fred Davis II resolved to RETIRED TE Fred Davis — normName
//     strips the "II", and the inactive TE's fantasy position won the tie.
//
// Both are real, both from one preseason game (2026-08-22 audit). So a name
// lookup ranks ACTIVE-WITH-A-TEAM first — a man on a roster this week outranks
// anyone who is not, whatever he plays — and only then falls back to the
// fantasy/search_rank preference for choosing between two live candidates.
const liveRank = (p) => {
  const onARoster = p.active && p.team ? 0 : 1e12;
  return onARoster + slugRank(p);
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
  const byGsis = new Map();   // nflverse gsis_id ("00-0035057", trimmed — Sleeper pads it) -> own slug (0169 true-up)
  // normName(full) -> every player carrying that name, as
  // { slug, team, rank } sorted best-first by `liveRank`. A LIST rather than a
  // winner, because the caller usually knows something we don't: which TEAM the
  // name just appeared for. See `slugForNameTeam`.
  const nameCands = new Map();
  const abbrCands = new Map(); // same, keyed by nflverse short name ("c jordan")
  const push = (map, key, cand) => {
    const arr = map.get(key);
    if (arr) arr.push(cand); else map.set(key, [cand]);
  };
  const bySleeperId = new Map(); // sleeper player_id -> { slug, full, pos, team, espnId }
  const bySlug = new Map();    // minted slug -> { full, pos, team } (engine Player objects)
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
      if (e.p.gsis_id && String(e.p.gsis_id).trim()) byGsis.set(String(e.p.gsis_id).trim(), slug);
      bySlug.set(slug, { full: e.full, pos: e.p.position, team: e.p.team, sid: e.sid });
      const cand = { slug, team: normTeam(e.p.team ?? ''), rank: liveRank(e.p) };
      push(nameCands, normName(e.full), cand);
      // nflverse short-name key ("C.Jordan" → "c jordan").
      const parts = e.full.trim().split(/\s+/);
      if (parts.length >= 2) push(abbrCands, normName(`${parts[0][0]} ${parts.slice(1).join(' ')}`), cand);
    }
  }
  // Best-first once, here, so every lookup is a scan of an already-ordered list.
  for (const arr of nameCands.values()) arr.sort((a, b) => a.rank - b.rank || a.slug.localeCompare(b.slug));
  for (const arr of abbrCands.values()) arr.sort((a, b) => a.rank - b.rank || a.slug.localeCompare(b.slug));

  /** Best candidate for a name, preferring one who plays for `team` when the
   *  caller knows it. THE TEAM IS THE STRONGEST SIGNAL WE HAVE for a player
   *  with no id: ESPN tells us which club the name just appeared for, and the
   *  directory says which club each namesake plays for. Where they agree the
   *  answer is not a ranking at all, it is a fact — which is what settles the
   *  two live namesakes (a DET Chris Smith is the DET one) without waiting for
   *  Sleeper to backfill an espn_id. Unknown/absent team falls back to the
   *  ranking, which now prefers the living. */
  const pick = (map, key, team) => {
    const arr = map.get(key);
    if (!arr?.length) return null;
    const want = normTeam(team ?? '');
    if (want) { const hit = arr.find((c) => c.team === want); if (hit) return hit.slug; }
    return arr[0].slug;
  };
  console.log(new Date().toISOString(), `player index: ${bySleeperId.size} players, ${collisions} colliding slugs disambiguated`);
  return {
    slugForEspnId: (id) => (id != null ? byEspnId.get(String(id)) ?? null : null),
    slugForGsis: (id) => (id ? byGsis.get(String(id).trim()) ?? null : null),
    /** `team` is optional and always worth passing: see `pick`. */
    slugForName: (name, team) => pick(nameCands, normName(name), team),
    /** nflverse short names ("C.Jordan"): initial + last. */
    slugForNflAbbr: (name, team) => pick(abbrCands, normName(String(name).replace('.', ' ')), team),
    /** How many directory entries carry this name — 1 means no namesake can be
     *  confused for this player, whatever else is unknown. Exported for the
     *  coverage probe rather than for resolution. */
    nameCount: (name) => (nameCands.get(normName(name))?.length ?? 0),
    sleeper: (sid) => bySleeperId.get(String(sid)) ?? null,
    metaForSlug: (slug) => bySlug.get(slug) ?? null,
    /** Every indexed player as { slug, full, pos, team, sid } (pod dealing). */
    allSlugs: () => [...bySlug.entries()].map(([slug, m]) => ({ slug, ...m })),
    size: bySleeperId.size,
  };
}
