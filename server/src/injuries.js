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
import { config } from './config.js';
import { normTeam } from '../../packages/core/src/data/slugMeta.ts';

// PAGED READS (v0.489.4). PostgREST answers any select with at most 1000 rows,
// silently, and BOTH reads below want the whole table. injury_status had no
// prune until 0489 — it accumulated every designation the poller had ever seen
// — so these have been quietly truncated for as long as they have existed, and
// a truncated ruled-out set does not look truncated: it looks like the players
// past the cap are fit, to the lock's auto-fill and to every price it computes.
// Ordered by the primary key so no row falls between pages.
const PAGE = 1000;
async function allRows(select) {
  const out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await select(from, from + PAGE - 1);
    if (error) return { rows: out, error };
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return { rows: out, error: null };
}

const TTL_MS = 60_000; // one fetch per tick, not one per matchup
let cache = null; // { at: ms, outs: Set<string> }

/** Slugs currently ruled OUT or on IR by the worker's own ESPN poll. A failed
 *  read serves the last known set (stale beats empty — an outage must not
 *  quietly re-start every injured player), or an empty set when there has
 *  never been a successful read. */
export async function ruledOutSlugs(now = Date.now()) {
  if (cache && now - cache.at < TTL_MS) return cache.outs;
  const { rows, error } = await allRows((from, to) => db().from('injury_status')
    .select('player_slug').in('status', ['O', 'IR']).order('player_slug').range(from, to));
  if (error) return cache?.outs ?? new Set();
  cache = { at: now, outs: new Set(rows.map((r) => r.player_slug)) };
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
  const { rows, error } = await allRows((from, to) => db().from('injury_status')
    .select('player_slug,status').order('player_slug').range(from, to));
  if (error) return statusCache?.map ?? new Map();
  statusCache = { at: now, map: new Map(rows.map((r) => [r.player_slug, String(r.status ?? '').toUpperCase()])) };
  return statusCache.map;
}

/** Test hook: drop the caches so the next call re-reads. */
export function clearRuledOutCache() { cache = null; statusCache = null; }


// ── HURT IN HIS GAME (v0.701.0) ──────────────────────────────────────────────
// Founder: "We need a way to not apply the 0 penalty to players who were
// injured during their game." The dart's −10 is for a no-show; a player who
// took the field and got hurt posted what he posted. The worker's own ESPN
// report dates each designation: one dated on or after his team's kickoff
// (and within the game's few days — a re-stamp weeks later must not read a
// later injury into this week) is an injury in that game. The commissioner's
// waiver (player_adjustment.hurt, 0493) covers what the report misses.
const HURT_WINDOW_MS = 4 * 24 * 3600_000;
/** Pure: the slugs hurt in their game this week. `rows` are injury_status rows
 *  (player_slug, status, designation_date, team); `kickoffs` team → ms. */
export function hurtInGame(rows, kickoffs, now = Date.now()) {
  const out = new Set();
  // both sides normalised (LA and LAR are one team, #1095)
  const kick = {};
  for (const [team, ms] of Object.entries(kickoffs ?? {})) kick[normTeam(String(team).toUpperCase())] = ms;
  for (const r of rows ?? []) {
    const at = r?.designation_date ? Date.parse(r.designation_date) : NaN;
    if (!Number.isFinite(at)) continue;
    const team = normTeam(String(r.team ?? '').toUpperCase());
    const k = kick[team];
    if (!Number.isFinite(k) || k > now) continue;
    if (at >= k && at <= k + HURT_WINDOW_MS) out.add(r.player_slug);
  }
  return out;
}
let hurtCache = null; // { at, week, set }
/** The week's hurt-in-game slugs, from the report and the slate; cached a minute. */
export async function hurtInGameSlugs(week, season = config.season, now = Date.now()) {
  if (hurtCache && hurtCache.week === week && now - hurtCache.at < TTL_MS) return hurtCache.set;
  const [inj, sl] = await Promise.all([
    allRows((from, to) => db().from('injury_status').select('player_slug,status,designation_date,team').order('player_slug').range(from, to)),
    db().from('nfl_slate').select('home,away,kickoff').eq('season', String(season)).eq('week', week),
  ]);
  if (inj.error || sl.error) return hurtCache?.set ?? new Set();
  const kickoffs = {};
  for (const g of sl.data ?? []) {
    const ms = g.kickoff ? Date.parse(g.kickoff) : NaN;
    if (!Number.isFinite(ms)) continue;
    for (const team of [g.home, g.away]) if (team) kickoffs[normTeam(String(team).toUpperCase())] = ms;
  }
  hurtCache = { at: now, week, set: hurtInGame(inj.rows, kickoffs, now) };
  return hurtCache.set;
}
