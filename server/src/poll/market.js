// THE MARKET: how widely each player is rostered (v0.306.0, founder: "we want
// to refresh ADP and rosters and injury status several times a day").
//
// v0.302.0 gave the waiver wire and the draft board an OWN % sort off the only
// number this platform had — the share of its own drafted leagues rostering a
// player. Honest, and nearly meaningless at this size: one league of two reads
// 50%. ESPN publishes the real figure across its whole fantasy population, on
// the host this worker already lives on, for free.
//
// WHY THIS ISN'T 12MB (v0.306.1). `kona_player_info` is the view that carries
// ownership AND average draft position, and a naive pull of it is 12MB of JSON
// for 400 players. Two measurements took that apart:
//
//   • 12MB is the DECOMPRESSED size. Node's fetch sends `accept-encoding: gzip`
//     by default, so the wire cost was always 2.8MB, not 12.
//   • 91.4% of the payload is `stats` — 57 stat entries per player, weekly and
//     projected, none of which this poller reads. ESPN's `x-fantasy-filter`
//     narrows them: asking for full-season (`splitTypeIds: [0]`) REAL
//     (`sourceIds: [0]`) stats takes 57 entries down to 2, and the response to
//     **201KB on the wire** — 14× smaller, and smaller than the ownership-only
//     `players_wl` view this used to call.
//
// The filter asks a MEANINGFUL question on purpose. A nonexistent split type
// (99) zeroes the stats entirely and lands at 151KB, but it works by matching
// nothing rather than by asking for something, so it would break the day ESPN
// validates the value. 50KB is not worth resting on undefined behaviour.
//
// So one lean call now carries both numbers, and `adp` is filled. What it is
// NOT is the consensus blend the bake still holds: ESPN's ADP is ESPN's draft
// rooms, and measured against `adp2026.ts` it sits ~13 picks away at the
// median. That difference is the point of preferring it — it is live — and it
// is also why the baked value stays underneath as the fallback.
//
// Resolution is id-first then name, the same order — and for the same reason —
// as the injury poller: Sleeper's espn_id coverage is partial, and names drift.
// Team D/ST entries never resolve and are expected not to: the pool carries
// defences through its own K/DST path, not through the player directory.
import { db } from '../supabase.js';
import { espnProTeam } from '../../../packages/core/src/data/espn.ts';

const ENDPOINT = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons'
  + '/{SEASON}/segments/0/leaguedefaults/3?view=kona_player_info';
// ESPN wants the shape of the ask in a header rather than the query string.
// The two stat filters are what keep this at 201KB instead of 2.8MB — see the
// docblock above.
const FILTER = JSON.stringify({
  players: {
    limit: 400,
    sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'PPR' },
    filterStatsForSplitTypeIds: { value: [0] },
    filterStatsForSourceIds: { value: [0] },
  },
});

async function fetchMarket(season, tries = 3) {
  const url = ENDPOINT.replace('{SEASON}', String(season));
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { 'x-fantasy-filter': FILTER } });
      if (r.ok) return r.json();
    } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  return null;
}

/** Pull ESPN's draft position + ownership and upsert them by slug. */
export async function pollMarket(playerIndex, season) {
  const d = await fetchMarket(season);
  const list = d?.players ?? [];
  if (!list.length) return { rows: 0, seen: 0, unresolved: 0, priced: 0 };
  const now = new Date().toISOString();
  const rows = [];
  const seenSlugs = new Set();
  let unresolved = 0, priced = 0;
  for (const e of list) {
    const p = e?.player ?? e ?? {};
    const own = p.ownership ?? {};
    const pct = Number(own.percentOwned);
    const adp = Number(own.averageDraftPosition);
    const hasPct = Number.isFinite(pct);
    // ADP of 0 is ESPN's "undrafted", not the first pick of the draft.
    const hasAdp = Number.isFinite(adp) && adp > 0;
    if (!hasPct && !hasAdp) continue;
    // proTeamId is how this feed names a club (v0.345.0) — the name fallback's
    // disambiguator, so an ADP cannot land on a retired namesake.
    const slug = playerIndex.slugForEspnId(p.id) ?? playerIndex.slugForName(p.fullName ?? '', espnProTeam(p.proTeamId));
    if (!slug) { unresolved++; continue; }
    if (seenSlugs.has(slug)) continue;      // first (best-ranked) entry wins
    seenSlugs.add(slug);
    if (hasAdp) priced++;
    rows.push({
      slug,
      adp: hasAdp ? Math.round(adp * 10) / 10 : null,
      owned_pct: hasPct ? Math.max(0, Math.min(100, Math.round(pct))) : null,
      source: 'espn',
      updated_at: now,
    });
  }
  if (rows.length) {
    const { error } = await db().from('player_market').upsert(rows, { onConflict: 'slug' });
    if (error) throw new Error(`market upsert (${rows.length}): ${error.message}`);
  }
  return { rows: rows.length, seen: list.length, unresolved, priced };
}
