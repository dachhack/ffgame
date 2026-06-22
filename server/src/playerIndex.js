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

/** Build an index from the Sleeper player directory. */
export async function buildPlayerIndex() {
  const players = await getPlayers();
  const byEspnId = new Map(); // "12345" -> slug
  const byName = new Map();   // normName(full) -> slug
  const bySleeperId = new Map(); // sleeper player_id -> { slug, full, pos, team, espnId }
  for (const [sid, p] of Object.entries(players)) {
    const full = p.full_name || [p.first_name, p.last_name].filter(Boolean).join(' ');
    if (!full) continue;
    const slug = slugOf(full);
    bySleeperId.set(sid, { slug, full, pos: p.position, team: p.team, espnId: p.espn_id ? String(p.espn_id) : null });
    if (p.espn_id) byEspnId.set(String(p.espn_id), slug);
    if (!byName.has(normName(full))) byName.set(normName(full), slug);
  }
  return {
    slugForEspnId: (id) => (id != null ? byEspnId.get(String(id)) ?? null : null),
    slugForName: (name) => byName.get(normName(name)) ?? null,
    sleeper: (sid) => bySleeperId.get(String(sid)) ?? null,
    size: bySleeperId.size,
  };
}
