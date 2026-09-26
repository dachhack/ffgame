// Live play-by-play poller: ESPN summary → RealPlay rows → live_play.
// Reuses the validated adapter (scripts/espn/espnAdapter.mjs); only the persistence
// is new here. Slug resolution uses the Sleeper player index (espn_id bridge +
// name fallback), so plays key on the SAME slug as picks and lineups.
import { gameToRealPlays, gameToFeed, gameStatus, gameEvents } from '../../../scripts/espn/espnAdapter.mjs';
import { db } from '../supabase.js';

const SUM = (id, sport = 'nfl') =>
  `https://site.api.espn.com/apis/site/v2/sports/football/${sport === 'college' ? 'college-football' : 'nfl'}/summary?event=${id}`;

/** A college boxscore athlete IS his slug (0365): c-<espn_id>. No directory,
 *  no names — and a namesake in the NFL index can never absorb his plays. */
export const collegeResolveSlug = (_name, espnId) => (espnId != null && /^\d+$/.test(String(espnId)) ? `c-${espnId}` : null);

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 700 * (i + 1)));
  }
  throw new Error(`summary fetch failed: ${url}`);
}

/** Poll one game and upsert its normalized plays. Returns rows written. */
export async function pollGame(eventId, week, playerIndex, sport = 'nfl') {
  const sum = await getJson(SUM(eventId, sport));
  // ID-FIRST (0200): buildRoster hands us each boxscore athlete's ESPN id
  // alongside the display name — the id names the athlete actually in THIS
  // game, so a namesake elsewhere in the league can never absorb these plays.
  // Players Sleeper carries without an espn_id (real ones exist — e.g. a
  // starting kicker) fall back to the ranked name index, same as before.
  // The team is the fallback's disambiguator (v0.345.0) — buildRoster knows
  // which club each boxscore athlete appeared for, and for the 2026 rookie
  // class (no espn_id in Sleeper's directory) the name path is the only path.
  const resolveSlug = sport === 'college' ? collegeResolveSlug
    : (name, espnId, team) => playerIndex.slugForEspnId(espnId) ?? playerIndex.slugForName(name, team);
  const pbp = gameToRealPlays(sum, resolveSlug);

  // LIVE QB HITS / PASSES DEFENDED STAND DOWN ONCE CONFIRMED (v0.535.0). The
  // adapter estimates both from the play text; the nflverse true-up writes the
  // official credits under its own game id (2026_03_AWAY_HOME) a day later and
  // retires these. Once it has, a re-poll must not put the estimates back —
  // and dropping them from the set lets the reconcile below delete any left.
  const feedEarly = gameToFeed(sum);
  let confirmed = false;
  // Only a finished game can have been confirmed — skip the lookup while one
  // is being played (it would run on every 25-second poll).
  // (NFL only: the nflverse true-up never covers a college game.)
  if (sport !== 'college' && feedEarly && sum?.header?.competitions?.[0]?.status?.type?.completed) {
    const [, [awayT, homeT]] = feedEarly;
    const { data: nv } = await db().from('live_play').select('id')
      .eq('week', week).in('k', ['qbhit', 'pd']).like('game_id', `%\\_${awayT}\\_${homeT}`).limit(1);
    confirmed = (nv ?? []).length > 0;
  }
  const rows = [];
  for (const [slug, plays] of Object.entries(pbp)) {
    for (const p of plays) {
      if (confirmed && (p.k === 'qbhit' || p.k === 'pd')) continue;
      rows.push({
        week, game_id: eventId, player_slug: slug,
        c: p.c, t: p.t ?? null, pid: p.pid ?? null,
        k: p.k, y: p.y, td: p.td, ca: p.ca, tg: p.tg, to: p.to ?? null,
        // 0166 truth flags + 0167 return kind + 0168 tackle detail — null when absent
        fd: p.fd ?? null, cp: p.cp ?? null, ic: p.ic ?? null, sk: p.sk ?? null, rk: p.rk ?? null,
        tt: p.tt ?? null, hf: p.hf ?? null, p6: p.p6 ?? null,
      });
    }
  }
  // ESPN sometimes lists the SAME play under two drives (observed live at the
  // 2026 preseason opener when it restructured drives at halftime): duplicate
  // conflict keys make Postgres reject the WHOLE upsert batch ("ON CONFLICT DO
  // UPDATE command cannot affect row a second time") — which froze play
  // ingestion for the rest of the game while the game_feed write kept landing.
  // De-dupe on the conflict key, keeping the last occurrence (the re-listed
  // copy carries any revision).
  const byKey = new Map();
  for (const r of rows) byKey.set(`${r.pid}|${r.player_slug}|${r.k}`, r);
  const uniq = [...byKey.values()];
  if (uniq.length) {
    // RECONCILE — each poll carries the game's FULL current play set, and ESPN
    // revises plays mid-game (yardage corrections, a TD overturned on review, a
    // fumble added, a catch ruled incomplete). So:
    //   1) upsert by the unique key (week,game_id,pid,player_slug,k) — UPDATE on
    //      conflict, NOT ignore, so corrected values overwrite the stale row;
    //   2) delete any rows for this game no longer in the current set — a play
    //      reclassified to a different kind, or removed, so it can't double-count.
    // Re-polling unchanged plays is still a no-op (same key + same values).
    // supabase-js does NOT throw on write errors — surface them so the tick's
    // per-game catch logs the real failure instead of a healthy-looking count.
    const { error: upErr } = await db().from('live_play').upsert(uniq, { onConflict: 'week,game_id,pid,player_slug,k' });
    if (upErr) throw new Error(`live_play upsert (${uniq.length} rows): ${upErr.message}`);
    const present = new Set(uniq.map((r) => `${r.pid}|${r.player_slug}|${r.k}`));
    const { data: existing, error: exErr } = await db().from('live_play').select('id,pid,player_slug,k').eq('week', week).eq('game_id', eventId);
    if (exErr) throw new Error(`live_play stale scan: ${exErr.message}`);
    const staleIds = (existing ?? []).filter((e) => !present.has(`${e.pid}|${e.player_slug}|${e.k}`)).map((e) => e.id);
    if (staleIds.length) {
      const { error: delErr } = await db().from('live_play').delete().in('id', staleIds);
      if (delErr) throw new Error(`live_play stale delete (${staleIds.length}): ${delErr.message}`);
    }
  }

  // Game feed for the field visuals (FieldView/FieldBoard) — the SAME summary,
  // normalized to GamePlay[] by the adapter. Whole-doc upsert per game: each
  // poll carries the full current play set, so ESPN mid-game revisions
  // reconcile by replacement, no row-level diffing.
  const feed = feedEarly;
  if (feed) {
    const [key, [away, home], plays] = feed;
    // Real game state (pre|in|post) so clients never have to infer FINAL from
    // "no next play yet" — which reads halftime as game over (0103).
    const state = sum?.header?.competitions?.[0]?.status?.type?.state ?? null;
    // THE STATUS AND THE STOPPAGES (v0.434.3, 0313): halftime, the end of a
    // quarter, a delay, the live clock between snaps — and the timeouts,
    // two-minute warnings and period ends the play list skips. Both hosts
    // draw them in the score strip and the play-by-play.
    const status = gameStatus(sum);
    const events = gameEvents(sum);
    const { error: feedErr } = await db().from('game_feed').upsert(
      { week, game_id: String(eventId), key, away, home, plays, state, status, events, updated_at: new Date().toISOString() },
      { onConflict: 'week,game_id' },
    );
    if (feedErr) console.error(`[plays] game_feed upsert ${eventId}:`, feedErr.message);
  }
  return uniq.length;
}
