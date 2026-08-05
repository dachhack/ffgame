// Deep preseason pick pool — SHARED pure builder behind both entry points:
// the worker CLI (server/src/sync.js seed-preseason-pool) and the admin
// console's "deep pool" button (AdminPage → liveApi adminSeedPreseasonPool).
//
// Preseason games are played by the depth chart's back half, so the Week-1
// lineups the 🏈 preseason toggle clones would field starters who sit. This
// builds the replacement pool: every active skill player on the week's slate
// teams, depth-chart ordered (starters first within team+pos, unknown depth
// sinks to the back), plus the engine's synthetic team K/DST. Deliberately NO
// projection floor (unlike the DFS salary board) — the 3rd/4th stringers a
// floor would drop are exactly who scores on Thursday night.
//
// Each side pre-normalizes its player source into PoolRow (the server adapts
// the raw Sleeper directory, the client its parsed PlayerMeta map) so slug
// derivation stays with the side that owns its name conventions.

export interface PoolRow {
  sid: string | null;  // Sleeper player id (null for synthetics)
  slug: string;        // engine slug (normName-hyphenated)
  full: string;
  pos: string;         // QB | RB | WR | TE (others are dropped)
  team: string;
  depth: number;       // depth_chart_order; 99 when unknown
}

/** One starters_json entry — the superset shape every consumer reads
 *  (player_slug for the resolver, slug+full for the client pool). `team` is
 *  REQUIRED here even though older lineup rows lack it: the board resolves a
 *  missing team via the baked-2025 slug/stats maps (liveBoard poolToPlayer),
 *  which know nothing about current rookies — without the carried team, the
 *  entire rookie class silently drops off the board. */
export interface PoolEntry {
  slot: number; sleeper_id: string | null; player_slug: string; slug: string; full: string; pos: string; team: string;
}

const POS_ORDER: Record<string, number> = { QB: 0, RB: 1, WR: 2, TE: 3 };

export function poolFromRows(rows: PoolRow[], slateTeams: Set<string>): PoolEntry[] {
  const skill = rows.filter((r) =>
    r.slug && r.full && r.team && slateTeams.has(r.team) && POS_ORDER[r.pos] !== undefined);
  skill.sort((a, b) =>
    a.team.localeCompare(b.team) || POS_ORDER[a.pos] - POS_ORDER[b.pos] || a.depth - b.depth || a.full.localeCompare(b.full));
  const out: PoolEntry[] = skill.map((p, i) =>
    ({ slot: i, sleeper_id: p.sid, player_slug: p.slug, slug: p.slug, full: p.full, pos: p.pos, team: p.team }));
  let slot = out.length;
  for (const t of [...slateTeams].sort()) {
    out.push({ slot: slot++, sleeper_id: null, player_slug: `${t.toLowerCase()}-k`, slug: `${t.toLowerCase()}-k`, full: `${t} Kicker`, pos: 'K', team: t });
    out.push({ slot: slot++, sleeper_id: null, player_slug: `${t.toLowerCase()}-dst`, slug: `${t.toLowerCase()}-dst`, full: `${t} D/ST`, pos: 'DEF', team: t });
  }
  return out;
}
