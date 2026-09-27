// SCORES FOR EVERY COLLEGE GAME (v0.560.1).
//
// Founder, on the fields widget in CFB mode: "Looks good but missing a lot of
// CFB scores." The college context polls a game's play-by-play only when one
// of its schools has a rostered player (index.js collegeLiveSchools, 0371) —
// ~60 FBS games a Saturday, one summary request each, every tick. So every
// other game had no game_feed row at all, and the fields showed Saturday's
// finals as "Sat 6:00p" on Sunday.
//
// The scoreboard the context already fetched has every game's score and
// status. This writes each started game it doesn't poll as a SCORES-ONLY row:
// no plays, no events, status.score and status.lite. Rules:
//   • a game the context polls is never written here — pollGame owns it;
//   • a FULL row (plays from an earlier poll) is never overwritten — a lite
//     row only ever replaces a lite row or nothing;
//   • an unchanged row is not rewritten, so a quiet Saturday costs one read.
import { db } from '../supabase.js';
import { fixTeam } from '../../../scripts/espn/espnAdapter.mjs';

/** PURE: the rows to write. `polled` = event ids pollGame will cover;
 *  `existing` = game_id → { state, status } of the week's current rows. */
export function scoreOnlyRows(week, games, polled, existing, nowIso = new Date().toISOString()) {
  const out = [];
  for (const g of games ?? []) {
    if (!g?.eventId || polled.has(g.eventId)) continue;
    if (g.state !== 'in' && g.state !== 'post') continue;
    if (g.homeScore == null || g.awayScore == null || !g.home || !g.away) continue;
    const had = existing.get(g.eventId);
    if (had && had.status?.lite !== true) continue;          // a full feed: leave it
    const away = fixTeam(g.away), home = fixTeam(g.home);
    const status = { ...(g.status ?? {}), score: { away: g.awayScore, home: g.homeScore }, lite: true };
    if (had && had.state === g.state && had.status?.score?.away === g.awayScore
        && had.status?.score?.home === g.homeScore && had.status?.short === status.short) continue;
    out.push({ week, game_id: g.eventId, key: `${away}@${home}`, away, home, plays: [], events: [], state: g.state, status, updated_at: nowIso });
  }
  return out;
}

/** Write the week's scores-only rows. Returns how many were written. */
export async function writeCollegeScores(week, games, polled) {
  const started = (games ?? []).filter((g) => g?.eventId && !polled.has(g.eventId) && (g.state === 'in' || g.state === 'post'));
  if (!started.length) return 0;
  const { data, error } = await db().from('game_feed').select('game_id, state, status')
    .eq('week', week).in('game_id', started.map((g) => g.eventId));
  if (error) throw new Error(`game_feed read: ${error.message}`);
  const existing = new Map((data ?? []).map((r) => [String(r.game_id), r]));
  const rows = scoreOnlyRows(week, started, polled, existing);
  if (!rows.length) return 0;
  const { error: upErr } = await db().from('game_feed').upsert(rows, { onConflict: 'week,game_id' });
  if (upErr) throw new Error(`game_feed upsert: ${upErr.message}`);
  return rows.length;
}
