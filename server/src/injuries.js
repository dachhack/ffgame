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

/** Test hook: drop the cache so the next call re-reads. */
export function clearRuledOutCache() { cache = null; }
