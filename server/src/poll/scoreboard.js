// ESPN scoreboard: the schedule / kickoff / live game-state feed. Used to set
// matchup lock_at (first kickoff of the week) and to decide which games to poll
// for play-by-play right now.
// ESPN seasontype: 1 = preseason, 2 = regular, 3 = postseason. Defaults to regular;
// callers pass config.seasonType so a preseason game can be ingested for rehearsal.
import { windowIdsFromKickoffs } from '../../../src/data/nflSlate.ts';

const SB = (season, week, seasonType = 2) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=${seasonType}&week=${week}`;

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  throw new Error(`scoreboard fetch failed: ${url}`);
}

/** Normalized games for a season-week. state ∈ pre | in | post. */
export async function getGames(season, week, seasonType = 2) {
  const d = await getJson(SB(season, week, seasonType));
  return (d.events ?? []).map((e) => {
    const comp = e.competitions?.[0] ?? {};
    const cs = comp.competitors ?? [];
    const teams = cs.map((c) => c.team?.abbreviation);
    return {
      eventId: String(e.id),
      date: e.date,                                    // ISO kickoff
      kickoffMs: Date.parse(e.date),
      state: e.status?.type?.state ?? comp.status?.type?.state ?? 'pre', // pre|in|post
      completed: !!(e.status?.type?.completed),
      teams,
      home: cs.find((c) => c.homeAway === 'home')?.team?.abbreviation ?? teams[0],
      away: cs.find((c) => c.homeAway === 'away')?.team?.abbreviation ?? teams[1],
    };
  });
}

/** Bucket an ISO kickoff into a window id by its US-Eastern day + hour (Intl
 *  handles EDT/EST). Mirrors the client's winMetaFor (nflSlate.ts) — Sunday by
 *  hour, every other weekday its own named slate — so even the per-game
 *  fallback (used only when a week's kickoffs are incomplete) agrees with the
 *  ids the client derives. */
export function windowFromKickoff(iso) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date(iso));
  const wd = parts.find((p) => p.type === 'weekday')?.value;
  let hr = Number(parts.find((p) => p.type === 'hour')?.value ?? 13);
  if (hr === 24) hr = 0;
  if (wd === 'Mon') return 'mnf';
  if (wd === 'Wed') return 'wed';
  if (wd === 'Fri') return 'fri';
  if (wd === 'Sat') return 'sat';
  if (wd === 'Tue') return 'tue';
  if (wd !== 'Sun') return 'tnf';
  if (hr < 11) return 'am';
  if (hr < 15) return 'early';
  if (hr < 18) return 'late';
  return 'snf';
}

// ESPN team codes → our normalized codes (must match slugMeta.normTeam so a
// slate team compares equal to a player's slugMeta team). Mainly WSH→WAS, LAR→LA.
const TEAM_FIX = { LAR: 'LA', WSH: 'WAS', JAC: 'JAX', OAK: 'LV', SD: 'LAC', STL: 'LA' };
const fixTeam = (t) => TEAM_FIX[t] ?? t;

/** Normalized slate rows from already-fetched games: [{ away, home, win, kickoff }],
 *  team codes mapped to ours. Source of truth for slate-gating + the K/DST bye check.
 *  `win` comes from the SAME kickoff clustering the client uses for lineup windows
 *  (nflSlate.ts windowIdsFromKickoffs) — these ids key per-window sealing (lock.js
 *  winKicks) and the 0058 DB lock trigger, so a mismatch with the client's derived
 *  ids (e.g. a Friday preseason game as server-'tnf' vs client-'fri') would leave
 *  that window never sealing and its scores never publishing. */
export function slateFromGames(games) {
  const gs = (games ?? []).filter((g) => g.home && g.away && g.date);
  const kicks = gs.map((g) => Date.parse(g.date));
  const ids = gs.length && kicks.every(Number.isFinite) ? windowIdsFromKickoffs(kicks) : null;
  return gs.map((g, i) => ({ away: fixTeam(g.away), home: fixTeam(g.home), win: ids ? ids[i] : windowFromKickoff(g.date), kickoff: g.date }));
}

/** The live slate for a season-week from ESPN (fetches the scoreboard). */
export async function buildSlate(season, week, seasonType = 2) {
  return slateFromGames(await getGames(season, week, seasonType));
}

/** Earliest kickoff of the week (epoch ms), the matchup lock_at. */
export async function weekKickoffMs(season, week, seasonType = 2) {
  const games = await getGames(season, week, seasonType);
  const ks = games.map((g) => g.kickoffMs).filter(Number.isFinite);
  return ks.length ? Math.min(...ks) : null;
}

/** Event ids worth polling for PBP now (live, or recently kicked off), from an
 *  already-fetched games array — so a caller that just fetched the scoreboard
 *  doesn't pay for a second identical request. */
export function gamesToPollFrom(games) {
  return (games ?? []).filter((g) => g.state === 'in' || (g.state === 'post' && !g.completed)).map((g) => g.eventId);
}

/** The same, but fetches the scoreboard itself (for callers without one in hand). */
export async function gamesToPoll(season, week, seasonType = 2) {
  return gamesToPollFrom(await getGames(season, week, seasonType));
}

/** ESPN's notion of the current week for a season type — the scoreboard without
 *  an explicit `week` param reports the week it is showing. Needed in preseason,
 *  where Sleeper's /state/nfl week sits at 0 all August and can't drive week
 *  rollover. Null on any fetch/shape problem (callers keep their fallback). */
export async function espnCurrentWeek(season, seasonType = 2) {
  try {
    const d = await getJson(`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=${seasonType}`, 2);
    const n = Number(d?.week?.number);
    return Number.isFinite(n) && n >= 1 ? n : null;
  } catch { return null; }
}
