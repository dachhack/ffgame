// THE DAILY-SPORT POLLER (v0.564.0) — sport_game + game_stat_line, per day.
//
// For each sport the worker is asked to carry (SPORTS=nhl,mlb in the env —
// unset means none, so the NFL worker is unchanged), one pass:
//
//   1. the day's schedule → upsert every game's row (status, score, clock);
//   2. for each game that is live, or final and not yet stored as final,
//      the box score → upsert one line per player.
//
// Cumulative lines make the pass idempotent: every poll writes the whole
// line and a final's last write is the truth. A game already stored as
// final is left alone unless `force` (a true-up) says otherwise.
//
// Cadence is the caller's (index.js): tight while a game is live, relaxed
// when none is. `pollSportDay` is also the CLI's `sport-poll`.
import { db } from '../supabase.js';
import { adapterFor } from '../sports/index.js';
import { xrefKey } from './sportDirectory.js';

const log = (...a) => console.log('[sports]', ...a);

/** Today's date in the league's calendar (US Eastern), YYYY-MM-DD. A 10:30pm
 *  ET tip is still "today" at 1am ET; the feeds date games the same way. */
export function easternDate(now = new Date(), offsetDays = 0) {
  const d = new Date(now.getTime() + offsetDays * 86400e3);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

const gameRow = (g) => ({
  sport: g.sport, season: g.season, game_id: g.gameId, game_date: g.gameDate, start_utc: g.startUtc,
  status: g.status, away: g.away, home: g.home, away_score: g.awayScore, home_score: g.homeScore,
  clock: g.clock, game_type: g.gameType, updated_at: new Date().toISOString(),
});

const lineRow = (g, l, key) => ({
  sport: g.sport, season: g.season, game_id: g.gameId, player_key: key,
  ext_id: l.extId, full_name: l.name, team: l.team, pos: l.pos || null, played: !!l.played,
  line: l.line, updated_at: new Date().toISOString(),
});

/** Which of the day's games get a box-score fetch: live ones always; finals
 *  only until they are stored as final (or when forced). */
export function gamesToFetch(games, stored, force = false) {
  return games.filter((g) => {
    if (g.status === 'live') return true;
    if (g.status !== 'final') return false;
    return force || stored.get(g.gameId) !== 'final';
  });
}

/** One pass for one sport and one date. Returns counts. */
export async function pollSportDay(sport, date, { force = false } = {}) {
  const adapter = adapterFor(sport);
  const games = await adapter.schedule(date);
  // `live` is the SCHEDULE's word, not the box score's: a game the feed says
  // is on keeps the loop at its live cadence even while its box fetch fails.
  const counts = { sport, date, games: games.length, fetched: 0, lines: 0, live: games.filter((g) => g.status === 'live').length, errors: 0, rows: games };
  if (!games.length) return counts;

  const { data: existing } = await db().from('sport_game').select('game_id,status')
    .eq('sport', sport).eq('season', games[0].season).in('game_id', games.map((g) => g.gameId));
  const stored = new Map((existing ?? []).map((r) => [r.game_id, r.status]));

  const { error: gErr } = await db().from('sport_game').upsert(games.map(gameRow), { onConflict: 'sport,season,game_id' });
  if (gErr) throw new Error(`sport_game upsert: ${gErr.message}`);

  for (const g of gamesToFetch(games, stored, force)) {
    try {
      const { game, lines } = await adapter.game(g.gameId);
      counts.fetched++;
      // The box score's own view of the game (score, clock, status) is fresher
      // than the schedule's — write it too.
      const merged = { ...g, ...game, gameDate: g.gameDate || game.gameDate };
      const rows = [];
      for (const l of lines) {
        try { rows.push(lineRow(merged, l, await xrefKey(sport, l))); }
        catch (e) { counts.errors++; log(`${sport} ${g.gameId}: skipped ${l.name}: ${e.message}`); }
      }
      await db().from('sport_game').upsert(gameRow(merged), { onConflict: 'sport,season,game_id' });
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await db().from('game_stat_line').upsert(rows.slice(i, i + 200), { onConflict: 'sport,season,game_id,player_key' });
        if (error) throw new Error(`game_stat_line upsert: ${error.message}`);
      }
      counts.lines += rows.length;
    } catch (e) {
      counts.errors++;
      log(`${sport} ${g.gameId} (${g.away}@${g.home}): ${e.message}`);
    }
  }
  return counts;
}

/** A game the table still calls live from before yesterday — a suspended
 *  game, or one whose final never landed — is re-read from its box score,
 *  so it cannot hold a period's finals hostage. Returns how many moved. */
export async function repollStaleLive(sport, now = new Date()) {
  const adapter = adapterFor(sport);
  const { data: stale } = await db().from('sport_game').select('season, game_id, game_date')
    .eq('sport', sport).eq('status', 'live').lt('game_date', easternDate(now, -1));
  let moved = 0;
  for (const g of stale ?? []) {
    try {
      const { game, lines } = await adapter.game(g.game_id);
      const merged = { ...game, sport, season: g.season, gameId: g.game_id, gameDate: g.game_date };
      await db().from('sport_game').upsert(gameRow(merged), { onConflict: 'sport,season,game_id' });
      const rows = [];
      for (const l of lines) { try { rows.push(lineRow(merged, l, await xrefKey(sport, l))); } catch { /* skipped */ } }
      for (let i = 0; i < rows.length; i += 200) await db().from('game_stat_line').upsert(rows.slice(i, i + 200), { onConflict: 'sport,season,game_id,player_key' });
      if (game.status !== 'live') moved++;
    } catch (e) {
      log(`${sport} stale ${g.game_id}: ${e.message}`);
    }
  }
  return moved;
}

/** Every configured sport, today and yesterday (a late West-coast final
 *  lands after ET midnight). Returns whether any game is live (the caller
 *  tightens its cadence), the next start still ahead (so it can wake for
 *  a tip-off), and the games seen per sport (for the league lock pass). */
export async function tickSports(sports, now = new Date()) {
  let live = false, nextStartMs = null;
  const games = {};
  for (const sport of sports) {
    games[sport] = [];
    for (const off of [-1, 0]) {
      const date = easternDate(now, off);
      try {
        const c = await pollSportDay(sport, date);
        if (c.games) log(`${sport} ${date}: ${c.games} games, ${c.fetched} fetched, ${c.lines} lines${c.live ? `, ${c.live} live` : ''}${c.errors ? `, ${c.errors} errors` : ''}`);
        if (c.live) live = true;
        games[sport].push(...c.rows);
        for (const g of c.rows) {
          if (g.status === 'pre' && g.startUtc) {
            const t = Date.parse(g.startUtc);
            if (t > now.getTime() && (nextStartMs == null || t < nextStartMs)) nextStartMs = t;
          }
        }
      } catch (e) {
        log(`${sport} ${date}: ${e.message}`);
      }
    }
    try { const moved = await repollStaleLive(sport, now); if (moved) log(`${sport}: ${moved} stale live game(s) closed`); }
    catch (e) { log(`${sport} stale: ${e.message}`); }
  }
  return { live, nextStartMs, games };
}
