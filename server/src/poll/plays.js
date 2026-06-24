// Live play-by-play poller: ESPN summary → RealPlay rows → live_play.
// Reuses the validated adapter (scripts/espn/espnAdapter.mjs); only the persistence
// is new here. Slug resolution uses the Sleeper player index (espn_id bridge +
// name fallback), so plays key on the SAME slug as picks and lineups.
import { gameToRealPlays } from '../../../scripts/espn/espnAdapter.mjs';
import { db } from '../supabase.js';

const SUM = (id) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${id}`;

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 700 * (i + 1)));
  }
  throw new Error(`summary fetch failed: ${url}`);
}

/** Poll one game and upsert its normalized plays. Returns rows written. */
export async function pollGame(eventId, week, playerIndex) {
  const sum = await getJson(SUM(eventId));
  // ESPN play text only has names → resolve via the directory name index. (When
  // we later thread boxscore athlete ids through buildRoster, prefer
  // slugForEspnId to kill the residual initials collisions.)
  const resolveSlug = (name) => playerIndex.slugForName(name);
  const pbp = gameToRealPlays(sum, resolveSlug);

  const rows = [];
  for (const [slug, plays] of Object.entries(pbp)) {
    for (const p of plays) {
      rows.push({
        week, game_id: eventId, player_slug: slug,
        c: p.c, t: p.t ?? null, pid: p.pid ?? null,
        k: p.k, y: p.y, td: p.td, ca: p.ca, tg: p.tg, to: p.to ?? null,
      });
    }
  }
  if (rows.length) {
    // RECONCILE — each poll carries the game's FULL current play set, and ESPN
    // revises plays mid-game (yardage corrections, a TD overturned on review, a
    // fumble added, a catch ruled incomplete). So:
    //   1) upsert by the unique key (week,game_id,pid,player_slug,k) — UPDATE on
    //      conflict, NOT ignore, so corrected values overwrite the stale row;
    //   2) delete any rows for this game no longer in the current set — a play
    //      reclassified to a different kind, or removed, so it can't double-count.
    // Re-polling unchanged plays is still a no-op (same key + same values).
    await db().from('live_play').upsert(rows, { onConflict: 'week,game_id,pid,player_slug,k' });
    const present = new Set(rows.map((r) => `${r.pid}|${r.player_slug}|${r.k}`));
    const { data: existing } = await db().from('live_play').select('id,pid,player_slug,k').eq('week', week).eq('game_id', eventId);
    const staleIds = (existing ?? []).filter((e) => !present.has(`${e.pid}|${e.player_slug}|${e.k}`)).map((e) => e.id);
    if (staleIds.length) await db().from('live_play').delete().in('id', staleIds);
  }
  return rows.length;
}
