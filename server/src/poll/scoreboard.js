// ESPN scoreboard: the schedule / kickoff / live game-state feed. Used to set
// matchup lock_at (first kickoff of the week) and to decide which games to poll
// for play-by-play right now.
// ESPN seasontype: 1 = preseason, 2 = regular, 3 = postseason. Defaults to regular;
// callers pass config.seasonType so a preseason game can be ingested for rehearsal.
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

/** Bucket an ISO kickoff into one of the 5 fantasy windows by its US-Eastern day
 *  + hour (Intl handles EDT/EST). Mon → mnf; Sun by hour (early <3pm, late 3–6pm,
 *  snf ≥6pm); any other weekday (Thu, plus Tue/Wed/Fri/Sat edge games) → tnf. */
export function windowFromKickoff(iso) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false }).formatToParts(new Date(iso));
  const wd = parts.find((p) => p.type === 'weekday')?.value;
  let hr = Number(parts.find((p) => p.type === 'hour')?.value ?? 13);
  if (hr === 24) hr = 0;
  if (wd === 'Mon') return 'mnf';
  if (wd !== 'Sun') return 'tnf';
  if (hr < 15) return 'early';
  if (hr < 18) return 'late';
  return 'snf';
}

// ESPN team codes → our normalized codes (must match slugMeta.normTeam so a
// slate team compares equal to a player's slugMeta team). Mainly WSH→WAS, LAR→LA.
const TEAM_FIX = { LAR: 'LA', WSH: 'WAS', JAC: 'JAX', OAK: 'LV', SD: 'LAC', STL: 'LA' };
const fixTeam = (t) => TEAM_FIX[t] ?? t;

/** Normalized slate rows from already-fetched games: [{ away, home, win, kickoff }],
 *  team codes mapped to ours. Source of truth for slate-gating + the K/DST bye check. */
export function slateFromGames(games) {
  return (games ?? [])
    .filter((g) => g.home && g.away && g.date)
    .map((g) => ({ away: fixTeam(g.away), home: fixTeam(g.home), win: windowFromKickoff(g.date), kickoff: g.date }));
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

/** Event ids worth polling for PBP now (live, or recently kicked off). */
export async function gamesToPoll(season, week, seasonType = 2) {
  const games = await getGames(season, week, seasonType);
  return games.filter((g) => g.state === 'in' || (g.state === 'post' && !g.completed)).map((g) => g.eventId);
}
