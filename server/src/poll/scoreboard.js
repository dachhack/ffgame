// ESPN scoreboard: the schedule / kickoff / live game-state feed. Used to set
// matchup lock_at (first kickoff of the week) and to decide which games to poll
// for play-by-play right now.
const SB = (season, week) =>
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}`;

async function getJson(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 800 * (i + 1)));
  }
  throw new Error(`scoreboard fetch failed: ${url}`);
}

/** Normalized games for a season-week. state ∈ pre | in | post. */
export async function getGames(season, week) {
  const d = await getJson(SB(season, week));
  return (d.events ?? []).map((e) => {
    const comp = e.competitions?.[0] ?? {};
    const teams = (comp.competitors ?? []).map((c) => c.team?.abbreviation);
    return {
      eventId: String(e.id),
      date: e.date,                                    // ISO kickoff
      kickoffMs: Date.parse(e.date),
      state: e.status?.type?.state ?? comp.status?.type?.state ?? 'pre', // pre|in|post
      completed: !!(e.status?.type?.completed),
      teams,
    };
  });
}

/** Earliest kickoff of the week (epoch ms), the matchup lock_at. */
export async function weekKickoffMs(season, week) {
  const games = await getGames(season, week);
  const ks = games.map((g) => g.kickoffMs).filter(Number.isFinite);
  return ks.length ? Math.min(...ks) : null;
}

/** Event ids worth polling for PBP now (live, or recently kicked off). */
export async function gamesToPoll(season, week) {
  const games = await getGames(season, week);
  return games.filter((g) => g.state === 'in' || (g.state === 'post' && !g.completed)).map((g) => g.eventId);
}
