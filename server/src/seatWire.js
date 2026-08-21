// ── THE SWEEP THAT LETS AN UNCLAIMED SEAT TRANSACT (v0.338.0) ──────────────
//
// Seat agents (0180) have set lineups since v0.248.0 and have never once
// touched the wire, so an agent seat's injured starter stayed injured until
// February. This is the half that acts. The DECISION is pure and lives in
// packages/core/engine/seatWaivers.ts; everything here is gathering rows,
// spending the plan, and the handful of things that are only true on a server.
//
// The write path is the SAME `submit_waiver_claim` / `add_free_agent` a manager
// calls — 0213 widened their guard to admit the worker for a seat nobody holds
// rather than forking a parallel path that would drift from theirs. So every
// rule those functions enforce (seat caps, position caps, FAAB balances, the FA
// window, commissioner flags) binds the agent for free, and anything this file
// gets wrong is REFUSED rather than written.
import { db } from './supabase.js';
import { leagueSlotDefs, leagueBestball, slateAwareProj } from '../../packages/core/src/engine/classic.ts';
import { seatWirePlan } from '../../packages/core/src/engine/seatWaivers.ts';
import { setLeagueGolf, clearLeagueGolf } from '../../packages/core/src/engine/golf.ts';
import { setLeagueProjScoring, clearLeagueProjScoring, leagueCatalogOf } from '../../packages/core/src/engine/projScoring.ts';
import { modeOfSettings } from './resolve.js';
import { seatAgentsFor } from './agents.js';

/** How many claims a seat may have OUTSTANDING — pending ones included, not
 *  just the ones filed this run.
 *
 *  It counts what is already pending because the planner is deterministic: on
 *  the next sweep it picks the same best player, whose claim is still sitting
 *  unresolved, and `submit_waiver_claim` answers "claim already pending". At
 *  the original every-tick cadence that was a refused RPC and a log line every
 *  25 seconds from filing until the 3am run — thousands of them, burying the
 *  lines worth reading. Counting outstanding claims means the seat files two
 *  and then goes quiet until the waiver run answers. */
const MAX_OUTSTANDING_CLAIMS = 2;

/**
 * File waiver claims and free-agent adds for every unclaimed seat that wants
 * them. Returns how many transactions were accepted.
 *
 * `week` and `slate` come from the tick, exactly as `autoSlotClassicLineups`
 * takes them, so byes are proven from the same source the lineup fill uses.
 */
export async function sweepSeatWire(week, slate = null, log = () => {}) {
  // Only leagues that HAVE an agent seat are worth loading. seat_agent is
  // server-only and small, so this is the cheapest possible starting set.
  const { data: agentRows } = await db().from('seat_agent').select('league_id,roster_id');
  if (!agentRows?.length) return 0;
  const leagueIds = [...new Set(agentRows.map((r) => r.league_id))];

  const { data: lgs } = await db().from('league')
    .select('id,settings_json,lineup_policy').in('id', leagueIds);
  const { data: drafts } = await db().from('draft')
    .select('league_id,status').in('league_id', leagueIds);
  const complete = new Set((drafts ?? []).filter((d) => d.status === 'complete').map((d) => d.league_id));

  let done = 0;
  try {
    for (const lg of lgs ?? []) {
      // Through modeOfSettings, never the raw row: settings_json calls the
      // builder spec `roster_slots` while leagueSlotDefs reads `slots`, so a
      // raw row silently yields the default nine spots for a builder league.
      const mode = modeOfSettings(lg.settings_json);
      if (mode?.mode !== 'classic') continue;
      // No draft, no wire: every player is still unowned and `add_free_agent`
      // would refuse anyway. Skipping here keeps the log quiet in preseason.
      if (!complete.has(lg.id)) continue;

      // THE COMMISSIONER'S SWITCH (0213). Deliberately read here and not in
      // the RPC guard: turning it off must stop the agent ASKING, not change
      // what the database permits — otherwise a commissioner flipping it would
      // retroactively invalidate claims already sitting pending.
      const { data: on } = await db().rpc('league_agent_waivers', { p_league_id: lg.id });
      if (on === false) continue;

      // MODULE GLOBALS, INSTALLED UNCONDITIONALLY (the v0.303.1 / v0.310.0
      // lesson from autoSlotClassicLineups): golf inverts what "best" means and
      // the league's catalog decides what a point is. Skipping the default case
      // leaves the PREVIOUS league's rule in force over this one, which is how
      // a single golf league quietly mis-ranks the whole sweep.
      setLeagueGolf(mode?.golf === true);
      setLeagueProjScoring(leagueCatalogOf(mode));

      const slots = leagueSlotDefs(mode);
      const bestball = leagueBestball(mode);
      // An all-best-ball league fills itself at scoring time from whoever is on
      // the roster, so there is no "hole" for the wire to answer.
      if (!slots.length || slots.every((d) => bestball.includes(d.slot))) continue;

      const { data: pool } = await db().from('league_pool')
        .select('slug,pos,team,exp,waived_until').eq('league_id', lg.id).range(0, 1999);
      if (!pool?.length) continue;                 // a Sleeper mirror has no pool of its own
      const meta = new Map(pool.map((p) => [p.slug, p]));

      const { data: allRos } = await db().from('native_roster')
        .select('roster_id,slug,spot').eq('league_id', lg.id);
      const owned = new Set((allRos ?? []).map((r) => r.slug));

      // WHAT THIS SEAT HAS ALREADY ASKED FOR. A pending claim has not moved
      // anybody yet — the added player is still unowned and the dropped player
      // is still on the roster — so without this the planner re-derives the
      // identical plan every run and every claim is refused as a duplicate.
      const { data: pendRows } = await db().from('waiver_claim')
        .select('roster_id,add_slug,drop_slug').eq('league_id', lg.id).eq('status', 'pending');
      const pendingBySeat = new Map();
      for (const c of pendRows ?? []) {
        if (!pendingBySeat.has(c.roster_id)) pendingBySeat.set(c.roster_id, []);
        pendingBySeat.get(c.roster_id).push(c);
      }

      // no_add (0144) is enforced by a TRIGGER THAT RAISES, not by a returned
      // error, so a flagged add would abort this sweep rather than cost one
      // claim. The planner filters flags too, but through the engine's flag
      // CACHE — which this worker never installs per league (the same gap
      // lock.js documents for no_start). So this filter is the one that bites.
      const { data: flagRows } = await db().from('player_flag').select('slug,rules').eq('league_id', lg.id);
      const noAdd = new Set((flagRows ?? []).filter((f) => f.rules?.no_add === true).map((f) => f.slug));

      const now = Date.now();
      const available = pool
        .filter((p) => !owned.has(p.slug) && !noAdd.has(p.slug) && p.pos)
        .map((p) => ({
          id: p.slug, pos: p.pos, team: p.team, exp: p.exp ?? null,
          onWaivers: !!p.waived_until && new Date(p.waived_until).getTime() > now,
        }));
      if (!available.length) continue;

      const { data: mode2 } = await db().rpc('league_waiver_mode', { p_league_id: lg.id });
      const faab = mode2 === 'faab';
      const { data: seats } = await db().rpc('league_active_seats', { p_league_id: lg.id });
      const activeSeats = Number(seats) || 0;

      const agents = await seatAgentsFor([lg.id]);
      for (const seat of agentRows.filter((r) => r.league_id === lg.id)) {
        if (!agents.has(`${lg.id}:${seat.roster_id}`)) continue;   // claimed since we read
        const mine = (allRos ?? []).filter((r) => r.roster_id === seat.roster_id);
        // taxi/IR never start, so they are neither lineup value nor a drop the
        // planner may spend — it reasons about the ACTIVE roster only (0164).
        const pending = pendingBySeat.get(seat.roster_id) ?? [];
        // Already at its outstanding limit: it has spoken, and the waiver run
        // is what answers next. Nothing to compute.
        const room = MAX_OUTSTANDING_CLAIMS - pending.length;
        if (room <= 0) continue;
        const pendingAdds = new Set(pending.map((c) => c.add_slug));
        const pendingDrops = new Set(pending.map((c) => c.drop_slug).filter(Boolean));

        // A player already promised as the price of a pending claim is spent.
        // Removing him CANNOT change the lineup this plans against — a drop is
        // only ever chosen from players who are NOT in the best lineup — so
        // this narrows what may be dropped again without altering any value.
        const roster = mine.filter((r) => r.spot === 'active')
          .map((r) => meta.get(r.slug))
          .filter((p) => p && p.pos && !pendingDrops.has(p.slug))
          .map((p) => ({ id: p.slug, pos: p.pos, team: p.team, exp: p.exp ?? null }));
        if (!roster.length) continue;

        let budget = 0;
        if (faab) {
          const { data: b } = await db().rpc('member_faab',
            { p_league_id: lg.id, p_roster_id: seat.roster_id });
          budget = Number(b) || 0;
        }

        // Built per seat, not per league: `slateAwareProj` closes over the
        // slate and the outs, and reads the league catalog at CALL time — which
        // is now, after the installs above.
        const { data: injRows } = await db().from('injury_status')
          .select('player_slug').in('status', ['O', 'IR']);
        const outs = new Set((injRows ?? []).map((r) => r.player_slug));
        const valueOf = slateAwareProj(week, slate, (slug) => outs.has(slug));

        const plan = seatWirePlan(slots, roster, available.filter((p) => !pendingAdds.has(p.id)), valueOf, {
          faab,
          budget,
          // A pending claim with no drop will TAKE a seat if it wins, so the
          // places still open are the ones nothing has been promised.
          openSeats: Math.max(0, activeSeats - roster.length - pending.filter((c) => !c.drop_slug).length),
          maxClaims: room,
        });

        for (const c of plan) {
          try {
            const r = c.onWaivers
              ? await db().rpc('submit_waiver_claim', {
                p_league_id: lg.id, p_roster_id: seat.roster_id,
                p_add_slug: c.add, p_drop_slug: c.drop, p_bid: c.bid,
              })
              : await db().rpc('add_free_agent', {
                p_league_id: lg.id, p_roster_id: seat.roster_id,
                p_add_slug: c.add, p_drop_slug: c.drop,
              });
            const ok = r?.data?.ok === true;
            if (ok) {
              done += 1;
              // The pool this sweep is planning against is now stale for every
              // later seat in the league, and two agent seats chasing the same
              // free agent would otherwise both "succeed" in the plan and the
              // second be refused. Cheaper to stop offering him.
              owned.add(c.add);
              const i = available.findIndex((p) => p.id === c.add);
              if (i >= 0) available.splice(i, 1);
              log('seat wire', lg.id, seat.roster_id, c.kind, c.add,
                c.drop ? `for ${c.drop}` : '(open seat)', faab ? `$${c.bid}` : '');
            } else if (r?.data?.error) {
              // Not an error condition: the RPCs are the authority and refuse
              // for reasons this sweep cannot see (a race with a human, an FA
              // window that just shut). Logged, then dropped.
              log('seat wire refused', lg.id, seat.roster_id, c.add, r.data.error);
            }
          } catch (e) {
            log('seat wire', lg.id, seat.roster_id, c.add, e.message);
          }
        }
      }
    }
  } finally {
    // Leave no module global installed past the sweep — the next caller in this
    // process is a different league's tick.
    clearLeagueGolf();
    clearLeagueProjScoring();
  }
  return done;
}
