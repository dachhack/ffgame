// THE MARKET: how widely each player is rostered (v0.306.0, founder: "we want
// to refresh ADP and rosters and injury status several times a day").
//
// v0.302.0 gave the waiver wire and the draft board an OWN % sort off the only
// number this platform had — the share of its own drafted leagues rostering a
// player. Honest, and nearly meaningless at this size: one league of two reads
// 50%. ESPN publishes the real figure across its whole fantasy population, on
// the host this worker already lives on, for free.
//
// THE LIGHT VIEW, deliberately. `players_wl` is 105KB for the top 400 players
// and carries `ownership.percentOwned`. The other view that would also carry
// average draft position, `kona_player_info`, is 12MB for the same 400 — 115×
// the bytes — so ownership is polled on its own and ADP is not taken from here
// yet. That is not only a cost argument: ESPN's ADP is ESPN's draft rooms, and
// measured against the baked consensus blend it sits ~13 picks away at the
// median. Re-pointing the draft board at another market is a product decision,
// not a refresh, so this poller writes ownership and leaves `adp` null.
//
// Resolution is id-first then name, the same order — and for the same reason —
// as the injury poller: Sleeper's espn_id coverage is partial, and names drift.
// Team D/ST entries never resolve and are expected not to: the pool carries
// defences through its own K/DST path, not through the player directory.
import { db } from '../supabase.js';

const ENDPOINT = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons'
  + '/{SEASON}/segments/0/leaguedefaults/3?view=players_wl';
// ESPN wants the shape of the ask in a header rather than the query string.
const FILTER = JSON.stringify({
  players: { limit: 400, sortDraftRanks: { sortPriority: 1, sortAsc: true, value: 'PPR' } },
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

/** Pull ESPN's ownership percentages and upsert them by slug. */
export async function pollMarket(playerIndex, season) {
  const d = await fetchMarket(season);
  const list = d?.players ?? [];
  if (!list.length) return { rows: 0, seen: 0, unresolved: 0 };
  const now = new Date().toISOString();
  const rows = [];
  const seenSlugs = new Set();
  let unresolved = 0;
  for (const e of list) {
    const p = e?.player ?? e ?? {};
    const pct = Number(p.ownership?.percentOwned);
    if (!Number.isFinite(pct)) continue;
    const slug = playerIndex.slugForEspnId(p.id) ?? playerIndex.slugForName(p.fullName ?? '');
    if (!slug) { unresolved++; continue; }
    if (seenSlugs.has(slug)) continue;      // first (best-ranked) entry wins
    seenSlugs.add(slug);
    rows.push({ slug, owned_pct: Math.max(0, Math.min(100, Math.round(pct))), source: 'espn', updated_at: now });
  }
  if (rows.length) {
    // `adp` is intentionally absent from the payload rather than set to null:
    // a later ADP source can fill that column without this poller erasing it
    // every three hours.
    const { error } = await db().from('player_market').upsert(rows, { onConflict: 'slug' });
    if (error) throw new Error(`market upsert (${rows.length}): ${error.message}`);
  }
  return { rows: rows.length, seen: list.length, unresolved };
}
