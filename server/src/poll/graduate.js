// DEVY GRADUATION (0367) — a college player who joins an NFL team moves to his
// NFL slug in every league that holds him.
//
// ID ONLY, three steps, and he waits until all three hold:
//   1. graduation_candidates(): every college slug in any pool, with the
//      crosswalk's Sleeper id by ESPN id where it has one (player_xref, 0331).
//      No Sleeper id yet → not an NFL player we can place → skip. That keeps
//      ESPN requests to the handful who might have moved;
//   2. ESPN's NFL athlete endpoint lists him with a team (a college-only
//      athlete is a 404 there; checked 2026-09-26);
//   3. the player index turns the Sleeper id into our NFL slug.
// graduate_college_player does the rest, one league at a time, and records a
// conflict instead of guessing when another team already rosters the NFL row.
//
// CADENCE. Daily. The NFL draft is one weekend and signings trickle for weeks;
// a day's delay costs nobody a start (devy players never start).
import { db } from '../supabase.js';

const NFL_ATHLETE = (id) => `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${id}`;
const EVERY_MS = Number(process.env.GRADUATE_POLL_MS || 86400000);

/** ESPN's NFL athlete payload → his NFL team, or null if he isn't on one. */
export function nflTeamOf(payload) {
  const a = payload?.athlete ?? payload;
  const team = a?.team?.abbreviation;
  return team ? String(team) : null;
}

async function getAthlete(id) {
  const res = await fetch(NFL_ATHLETE(id), { headers: { accept: 'application/json' } });
  if (res.status === 404) return null;            // still a college player
  if (!res.ok) throw new Error(`${res.status} athlete ${id}`);
  return res.json();
}

/** One pass. Injected fetch/rpc keep it testable. */
export async function runGraduation(playerIndex, log = () => {},
  fetchAthlete = getAthlete, rpc = (fn, args) => db().rpc(fn, args)) {
  const { data: cands, error } = await rpc('graduation_candidates', {});
  if (error) return { checked: 0, graduated: 0, conflicts: 0, error: error.message };
  let checked = 0, graduated = 0, conflicts = 0, waiting = 0;
  for (const c of cands ?? []) {
    if (!c.sleeper_id) continue;
    const meta = playerIndex?.sleeper?.(c.sleeper_id);
    if (!meta?.slug) { waiting++; continue; }      // the index doesn't have him yet
    checked++;
    let team;
    try { team = nflTeamOf(await fetchAthlete(c.espn_id)); }
    catch (e) { log('graduate', c.espn_id, e.message); continue; }
    if (!team) continue;
    const { data, error: gerr } = await rpc('graduate_college_player', {
      p_espn_id: String(c.espn_id), p_new_slug: meta.slug, p_full_name: meta.full,
      p_pos: meta.pos, p_team: meta.team ?? team, p_sleeper_id: String(c.sleeper_id),
    });
    if (gerr) { log('graduate', c.espn_id, gerr.message); continue; }
    graduated += Number(data?.leagues ?? 0);
    conflicts += Number(data?.conflicts ?? 0);
    if (data?.leagues) log(`graduated ${meta.full} (${c.espn_id} → ${meta.slug}) in ${data.leagues} league(s)`);
  }
  return { checked, graduated, conflicts, waiting };
}

let last = 0;
let inflight = null;

/** The tick's entry point: daily, detached, never overlapping. */
export function sweepGraduation(playerIndex, log = () => {}) {
  // No index yet (worker just booted): wait for it rather than spend the day.
  if (!playerIndex || inflight || Date.now() - last < EVERY_MS) return false;
  last = Date.now();
  inflight = runGraduation(playerIndex, log)
    .then((r) => { if (r.graduated || r.conflicts || r.error) log(`graduation: ${r.graduated} league moves, ${r.conflicts} conflicts` + (r.error ? ` — ${r.error}` : '')); })
    .catch((e) => log('graduation error', e.message))
    .finally(() => { inflight = null; });
  return true;
}
