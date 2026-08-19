// NFL ROSTER SWEEP (v0.305.0, founder: "we want to refresh ADP and rosters and
// injury status several times a day").
//
// Where a player plays already had a live path — `syncTeamOverrides` diffs
// Sleeper's directory against the baked `playerBio.ts` and publishes the drift
// into `player_team_override` (0142). What it did not have was a CADENCE worth
// the name: the directory is 14MB and Sleeper asks for at most one pull a day,
// so the whole team map moved once every twenty-four hours. Cut-down week does
// not work like that. Neither does a Tuesday waiver claim, a Wednesday signing,
// or a practice-squad elevation on a Saturday.
//
// So the two questions get two feeds, at the cadence each one deserves:
//
//   • WHO EXISTS, and what slug/espn_id is he — Sleeper's directory, daily. It
//     is the slug index the whole engine keys on, and it genuinely changes
//     slowly.
//   • WHERE DOES HE PLAY — ESPN's 32 team rosters, several times a day. Small,
//     already inside the ESPN budget this worker lives on, and resolved by
//     ESPN ATHLETE ID, which is the bridge the player index was built around
//     precisely because names drift and ids don't.
//
// Both write through `reconcileTeamOverrides`, so they cannot disagree about
// what the table means — only about how recently they looked.
//
// THIS SWEEP IS ADDITIVE ONLY, and that is the important line in this file.
//
// A tempting reading of a 32-team census is "anyone I didn't see has been cut".
// It is wrong here, and a dry run against the live feed proved how wrong before
// this shipped: `playerBio.ts` is a 5,363-player HISTORICAL directory, most of
// whom have not been on an NFL roster for years. Treating absence as a release
// would have written ~4,000 free-agent rows into a table whose whole design
// note says "dozens to a few hundred", and declared most of the league cut.
//
// So each feed is trusted for what it is actually good at. ESPN's rosters make
// a POSITIVE statement — this player is on this club today — which is exactly
// the fact that moves during a cut-down week, and the sweep publishes only
// that. Deciding that somebody is on NO team requires knowing the whole
// universe of players, which is the Sleeper directory's job: it carries an
// explicit null team and covers everyone, and it keeps running daily.
//
// The cost is bounded and worth naming: a released player keeps his old club
// on screen until the next daily pass. Against that, the alternative was
// releasing four thousand players every three hours.
import { reconcileTeamOverrides } from './teamOverrides.js';

const ROSTER = (id) => `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${id}/roster`;
// ESPN's own team ids, 1..34 with 31/32 unused — enumerated rather than ranged
// so a gap can never be read as a failed fetch.
export const ESPN_TEAM_IDS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
  17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 33, 34,
];
async function fetchTeam(id, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(ROSTER(id)); if (r.ok) return r.json(); } catch { /* retry */ }
    await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  return null;
}

/** Sweep all 32 rosters and republish the team map.
 *
 *  `playerIndex` resolves ESPN athletes to the shared slug — id first, then
 *  name, the same order the injury poller uses and for the same reason.
 *  Returns the reconcile's counts plus how much of the league it actually read,
 *  so a sweep that quietly saw four teams is visible in the log rather than
 *  indistinguishable from a quiet week. */
export async function pollRosters(playerIndex) {
  const live = new Map();     // slug -> team abbreviation
  let teams = 0, athletes = 0;
  for (const id of ESPN_TEAM_IDS) {
    const d = await fetchTeam(id);
    if (!d) continue;
    const abbr = d.team?.abbreviation ? String(d.team.abbreviation).toUpperCase() : null;
    if (!abbr) continue;
    teams++;
    for (const g of d.athletes ?? []) {
      for (const a of g.items ?? []) {
        athletes++;
        const slug = playerIndex.slugForEspnId(a.id) ?? playerIndex.slugForName(a.fullName ?? '');
        // First team wins: a player listed twice across groups (active and
        // practice squad both appear) is on that club either way.
        if (slug && !live.has(slug)) live.set(slug, abbr);
      }
    }
  }
  // `full: false` — never prune. See the docblock: absence from this map is not
  // evidence of a release, and the daily Sleeper pass is what retires a row.
  const r = await reconcileTeamOverrides(live, false);
  return { ...r, teams, athletes };
}
