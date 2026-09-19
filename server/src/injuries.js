// THE ONE RULED-OUT SET — every worker path that builds or values a lineup
// asks this module who cannot play, instead of fetching and filtering
// injury_status itself.
//
// The rule (v0.252.0, unchanged): O and IR only. Questionable and doubtful
// players play often enough that auto-benching them would overrule real
// decisions — a manager can bench their own Q; the worker must not.
//
// Why the table and not core's injuryFor: on the server no live report is
// installed and no season is set, so injuryFor falls back to the BAKED 2025
// tags — the worker would bench 2026 players for last year's injuries
// (engine/classic.ts documents the same trap for its own predicate). The
// worker reads its OWN ESPN poll (injury_status, polled since 0001) directly.
//
// Before v0.341.2 this fetch+filter existed verbatim in three places (classic
// auto-slot, classic resolve, seat wire) while the two DRIP paths — the
// lock-time fill and the resolve-time aiSide rebuild — had no injury
// awareness at all and could field a player ruled OUT. Now all five ask here.
import { db } from './supabase.js';

const TTL_MS = 60_000; // one fetch per tick, not one per matchup
let cache = null; // { at: ms, outs: Set<string> }

/** Slugs currently ruled OUT or on IR by the worker's own ESPN poll. A failed
 *  read serves the last known set (stale beats empty — an outage must not
 *  quietly re-start every injured player), or an empty set when there has
 *  never been a successful read. */
export async function ruledOutSlugs(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.outs;
  const { data, error } = await db().from('injury_status')
    .select('player_slug').in('status', ['O', 'IR']);
  if (error) return cache?.outs ?? new Set();
  cache = { at: now, outs: new Set((data ?? []).map((r) => r.player_slug)) };
  return cache.outs;
}

let statusCache = null; // { at: ms, map: Map<slug, status> }

/** Every designation the worker's ESPN poll holds, slug → status (O, D, Q,
 *  IR, …), for the paths that need to tell IR from O rather than lump both
 *  as "cannot play this week" (v0.426.0): the seat wire stashes on the
 *  league's own IR list and values a season-ending IR at nothing for the
 *  rest of the year, while an O is one missed Sunday. Same cache rule as
 *  ruledOutSlugs — a failed read serves the last known map. */
export async function injuryStatusMap(now = Date.now()) {
  if (statusCache && now - statusCache.at < TTL_MS) return statusCache.map;
  const { data, error } = await db().from('injury_status').select('player_slug,status');
  if (error) return statusCache?.map ?? new Map();
  statusCache = { at: now, map: new Map((data ?? []).map((r) => [r.player_slug, String(r.status ?? '').toUpperCase()])) };
  return statusCache.map;
}

/** Test hook: drop the caches so the next call re-reads. */
export function clearRuledOutCache() { cache = null; statusCache = null; }
