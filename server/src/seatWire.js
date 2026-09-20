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
//
// ── AI SEATS TOO (v0.425.0) ──────────────────────────────────────────────────
// Founder: "It's essential that the AI makes waiver moves in the vampire
// league." A seat whose controller is 'ai' (🤖) is deliberately NOT agented —
// agents.js explains why: its lineup is composed at resolve by aiSide, and an
// agent's sealed rows would override that. The unmeasured cost was that an AI
// seat could never transact at all: no seat_agent row, so 0213's gate refused
// the worker, so this sweep never even asked. In a vampire league that is a
// bot vampire — which does not draft (0268) — sitting on an EMPTY roster all
// season, because the pool was its only cradle and the only hand that could
// reach in was never allowed to. 0298 widens the gate to an AI seat nobody
// holds; this sweep now walks those seats beside the agent seats, and lets a
// roster with open places FILL them rather than filing two claims an hour.
//
// ── THE MANAGER'S JUDGEMENT (v0.426.0) ───────────────────────────────────────
// Founder: "Do we have a good projections logic for deciding those pick ups
// would help the team? Like if the team doesn't have a WR to fill a spot or
// is light on RBs, the AI controlled team will make a waiver move (and not
// drop players that have more value or score well rest of season). Also put
// players in IR?" Three things the sweep now does that it did not:
//   • IR HOUSEKEEPING, before it plans: a player on the active roster whose
//     designation is on the league's own IR list (0198 league_ir_tags) goes
//     to an open IR place, and a player on IR whose designation has cleared
//     comes back when an active place is open — through set_roster_spot,
//     which 0299 lets the worker call on 0213's terms. Freeing the seat is
//     what lets the replacement be signed without a drop.
//   • REST-OF-SEASON VALUE decides every drop. This week's value (the slate-
//     aware projection: bye → 0, ruled out → 0) is right for choosing who
//     STARTS and wrong for choosing who GOES — it made a star on his bye the
//     cheapest bench body. The planner is handed the season projection,
//     zero only for a season-ending IR, and never drops a player worth more
//     for the rest of the year than the one it adds.
//   • THE THIN POSITION fills first when the lineup itself wants nothing.
import { db } from './supabase.js';
import { ruledOutSlugs, injuryStatusMap } from './injuries.js';
import { leagueSlotDefs, leagueBestball, leagueGolfZeroPtsOf, slateAwareProj } from '../../packages/core/src/engine/classic.ts';
import { playRisk } from '../../packages/core/src/engine/golfFloor.ts';
import { seatWirePlan, shortlistWire } from '../../packages/core/src/engine/seatWaivers.ts';
import { setLeagueGolf, clearLeagueGolf } from '../../packages/core/src/engine/golf.ts';
import { setLeagueProjScoring, clearLeagueProjScoring, leagueCatalogOf, projectedPoints } from '../../packages/core/src/engine/projScoring.ts';
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

/** THE FRENZY (v0.428.0). When the wire holds several players worth real
 *  surplus at once — a guillotine chop just dropped a whole roster — two
 *  outstanding claims is one bid on the star and one consolation. A seat
 *  may have this many out while the pile is deep; the planner prices each
 *  from the running budget, so they never sum past it. */
const FRENZY_MAX_CLAIMS = 4;
/** …a pile is "deep" when at least this many held players clear this
 *  surplus (pts/wk over the best free agent at their position). */
const FRENZY_MIN_PLAYERS = 3;
const FRENZY_MIN_SURPLUS = 2;
/** Resolved claims read for calibration — the recent past, not the archive. */
const HISTORY_ROWS = 200;

/** Most OPEN roster places one sweep fills. Adds into an open seat are
 *  immediate `add_free_agent` calls, not pending claims, so they are not
 *  bounded by MAX_OUTSTANDING_CLAIMS — and a roster the draft left empty
 *  should be a roster by the next lock, not eight sweeps later. */
const MAX_OPEN_SEAT_FILLS = 16;

/**
 * File waiver claims and free-agent adds for every seat the worker may act
 * for — unclaimed (agent) seats and AI seats nobody holds — that wants them.
 * Returns how many transactions were accepted.
 *
 * `week` and `slate` come from the tick, exactly as `autoSlotClassicLineups`
 * takes them, so byes are proven from the same source the lineup fill uses.
 */
export async function sweepSeatWire(week, slate = null, log = () => {}) {
  // Only leagues that HAVE a seat the worker may act for are worth loading:
  // agent seats (seat_agent is server-only and small) and AI seats nobody
  // holds (v0.425.0 — the same "nobody at the seat" rule 0298's gate
  // re-checks; a manager who flipped their OWN team to auto-pilot keeps
  // their roster, so app_user_id must be null here as it is there).
  const { data: agentRows } = await db().from('seat_agent').select('league_id,roster_id');
  const { data: aiRows } = await db().from('league_membership')
    .select('league_id,sleeper_roster_id').eq('controller', 'ai').is('app_user_id', null);
  const seatRows = (agentRows ?? []).map((r) => ({ league_id: r.league_id, roster_id: r.roster_id, kind: 'agent' }));
  const agented = new Set(seatRows.map((r) => `${r.league_id}:${r.roster_id}`));
  for (const r of aiRows ?? []) {
    if (agented.has(`${r.league_id}:${r.sleeper_roster_id}`)) continue;   // an agented seat is an agent seat
    seatRows.push({ league_id: r.league_id, roster_id: r.sleeper_roster_id, kind: 'ai' });
  }
  if (!seatRows.length) return 0;
  const leagueIds = [...new Set(seatRows.map((r) => r.league_id))];

  const { data: lgs } = await db().from('league')
    .select('id,settings_json,lineup_policy').in('id', leagueIds);
  const { data: drafts } = await db().from('draft')
    .select('league_id,status').in('league_id', leagueIds);
  const complete = new Set((drafts ?? []).filter((d) => d.status === 'complete').map((d) => d.league_id));

  let done = 0;
  const irTagsOf = new Map();
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
      setLeagueGolf(mode?.golf === true, leagueGolfZeroPtsOf(mode));
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

      // THE SEAT IS STILL THE WORKER'S TO ACT FOR — re-read now, not at the
      // top of the sweep: a human may have claimed an agent seat or been
      // handed a bot's chair since. Agent seats prove it through seat_agent
      // (the claim trigger retires the row); AI seats through the membership
      // row itself. The RPC re-checks both anyway (0298); this just keeps a
      // refused call out of the log. faab_budget and eliminated_week ride
      // along for THE ROOM below.
      const { data: memRows } = await db().from('league_membership')
        .select('sleeper_roster_id,app_user_id,controller,faab_budget,eliminated_week').eq('league_id', lg.id);
      const memOf = new Map((memRows ?? []).map((m) => [m.sleeper_roster_id, m]));

      const { data: irTagRows } = await db().rpc('league_ir_tags', { p_league_id: lg.id });
      irTagsOf.set(lg.id, Array.isArray(irTagRows) ? irTagRows : ['IR', 'O']);
      const { data: mode2 } = await db().rpc('league_waiver_mode', { p_league_id: lg.id });
      const faab = mode2 === 'faab';
      const { data: seats } = await db().rpc('league_active_seats', { p_league_id: lg.id });
      const activeSeats = Number(seats) || 0;

      // ── THE ROOM (v0.428.0) ─────────────────────────────────────────────
      // Founder: "Waiver wire can be a frenzy. We need a good way for AIs to
      // make FAAB bids with competitive valuations without over bidding."
      // What a bid has to beat is read once per league: every living seat's
      // remaining FAAB (a chopped guillotine seat cannot bid), the weeks
      // still to come, and the league's own resolved claims — each re-priced
      // at today's surplus against the league's starting budget, the honest
      // stand-in for the bidder's balance at the time. The pricing itself
      // is core's faabMarket, through the planner.
      const startBudget = Number(lg.settings_json?.faab_budget) || 100;
      const budgetOf = (m) => (Number.isFinite(Number(m?.faab_budget)) && m?.faab_budget != null ? Number(m.faab_budget) : startBudget);
      let weeksLeft = 0;
      let history = [];
      if (faab) {
        const { data: wks } = await db().from('matchup').select('week')
          .eq('league_id', lg.id).gte('week', week).lt('week', 100);
        weeksLeft = new Set((wks ?? []).map((w) => w.week)).size;
        const { data: past } = await db().from('waiver_claim')
          .select('add_slug,bid,status').eq('league_id', lg.id).in('status', ['won', 'lost']).gt('bid', 0)
          .order('processed_at', { ascending: false }).limit(HISTORY_ROWS);
        history = past ?? [];
      }

      const agents = await seatAgentsFor([lg.id]);
      for (const seat of seatRows.filter((r) => r.league_id === lg.id)) {
        if (seat.kind === 'agent') {
          if (!agents.has(`${lg.id}:${seat.roster_id}`)) continue;   // claimed since we read
        } else {
          const m = memOf.get(seat.roster_id);
          if (!m || m.controller !== 'ai' || m.app_user_id) continue;   // handed back, or a human sat down
        }
        // A seat the format has shut out of the wire — a chopped guillotine
        // seat, a non-vampire under the vampire's wire lock (0272) — would be
        // refused by the RPC on every claim, every hour. Ask once and move on.
        const { data: blocked } = await db().rpc('wire_block_reason',
          { p_league_id: lg.id, p_roster_id: seat.roster_id });
        if (blocked) continue;
        const mine = (allRos ?? []).filter((r) => r.roster_id === seat.roster_id);

        // ── IR HOUSEKEEPING (v0.426.0) ───────────────────────────────────────
        // The league's list decides who qualifies (0198), the shape how many
        // fit (0164). A player is stashed when he qualifies and a place is
        // open; brought back when he no longer qualifies and an active place
        // is open. Each move is set_roster_spot's to refuse, and a refusal
        // here is logged and left — the RPC is the authority. `mine` is
        // updated in place so the plan below reads the roster as it now is.
        const statuses = await injuryStatusMap();
        // Rest-of-season value (v0.426.0), needed here already for the depth
        // of the wire and again below for every drop and price.
        const statusesRos = (p) => (statuses.get(p.id) === 'IR' ? 0
          : projectedPoints({ id: p.id, pos: p.pos ?? '', team: p.team }));
        const irTags = new Set((irTagsOf.get(lg.id) ?? []).map((t) => String(t).toUpperCase()));
        const irCap = Number(lg.settings_json?.roster_shape?.ir) || 0;
        const qualifies = (slug) => irTags.has(statuses.get(slug) ?? '');
        const move = async (row, spot) => {
          try {
            const r = await db().rpc('set_roster_spot', { p_league_id: lg.id, p_slug: row.slug, p_spot: spot });
            if (r?.data?.ok === true) { row.spot = spot; log('seat wire', lg.id, `${seat.kind} seat`, seat.roster_id, spot === 'ir' ? 'stashed' : 'activated', row.slug, `(${statuses.get(row.slug) ?? 'no tag'})`); return true; }
            if (r?.data?.error) log('seat wire refused', lg.id, seat.roster_id, row.slug, '→', spot, r.data.error);
          } catch (e) { log('seat wire', lg.id, seat.roster_id, row.slug, '→', spot, e.message); }
          return false;
        };
        if (irCap > 0) {
          for (const row of mine.filter((r) => r.spot === 'active' && qualifies(r.slug))) {
            if (mine.filter((r) => r.spot === 'ir').length >= irCap) break;
            await move(row, 'ir');
          }
        }
        for (const row of mine.filter((r) => r.spot === 'ir' && !qualifies(r.slug))) {
          if (mine.filter((r) => r.spot === 'active').length >= activeSeats) break;
          await move(row, 'active');
        }

        // taxi/IR never start, so they are neither lineup value nor a drop the
        // planner may spend — it reasons about the ACTIVE roster only (0164).
        const pending = pendingBySeat.get(seat.roster_id) ?? [];
        // Already at its outstanding limit: it has spoken, and the waiver run
        // is what answers next. Nothing to compute. The limit widens while
        // the wire is deep (v0.428.0 — a chop just landed): one claim on the
        // star and one consolation is not a bid in a frenzy.
        const deep = (() => {
          const repl = new Map();
          const rv = (p) => (statusesRos(p));
          let n = 0;
          for (const p of available) {
            if (!p.onWaivers) continue;
            if (!repl.has(p.pos)) repl.set(p.pos, Math.max(0, ...available.filter((q) => !q.onWaivers && q.pos === p.pos).map(rv)));
            if (rv(p) - repl.get(p.pos) >= FRENZY_MIN_SURPLUS) n += 1;
          }
          return n >= FRENZY_MIN_PLAYERS;
        })();
        const room = (faab && deep ? FRENZY_MAX_CLAIMS : MAX_OUTSTANDING_CLAIMS) - pending.length;
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
        // An EMPTY roster is not "nothing to do" — it is the most to do. A bot
        // vampire sits out the draft (0268) and starts the season with no one;
        // before v0.425.0 this line skipped it, so the seat the format most
        // needs on the wire was the one seat the wire never touched.

        let budget = 0;
        if (faab) {
          const { data: b } = await db().rpc('member_faab',
            { p_league_id: lg.id, p_roster_id: seat.roster_id });
          budget = Number(b) || 0;
        }

        // Built per seat, not per league: `slateAwareProj` closes over the
        // slate and the outs, and reads the league catalog at CALL time — which
        // is now, after the installs above.
        const outs = await ruledOutSlugs();
        // Play risk rides along (v0.429.0): priced in golf, ignored elsewhere.
        const valueOf = slateAwareProj(week, slate, (slug) => (outs.has(slug) ? true : playRisk(statuses.get(slug))));
        // Rest-of-season value: the season projection under the league's
        // catalog, untouched by this week's bye or a one-game Out, zero for a
        // season-ending IR. This is what a drop is judged by (v0.426.0).
        const rosValueOf = statusesRos;

        // A pending claim with no drop will TAKE a seat if it wins, so the
        // places still open are the ones nothing has been promised.
        const openSeats = Math.max(0, activeSeats - roster.length - pending.filter((c) => !c.drop_slug).length);
        const fills = Math.min(openSeats, MAX_OPEN_SEAT_FILLS);

        // The candidates: the best few at each position for the REST OF THE
        // SEASON (core's shortlistWire — deterministic, ties by slug). Ranked
        // by the season rather than the week so a bye-week starter is still
        // on the list for a depth add, and this week's value still decides
        // a hole.
        const candidates = shortlistWire(available.filter((p) => !pendingAdds.has(p.id)), rosValueOf);

        // Replacement level: the best FREE body at a position — what anyone
        // could sign for nothing this minute — so a claim is measured over
        // it, not over zero. A held player's surplus is what the room bids on.
        const replacementOf = (pos) => Math.max(0, ...available.filter((p) => !p.onWaivers && p.pos === pos).map(rosValueOf));
        const market = faab ? {
          rivalBudgets: (memRows ?? [])
            .filter((m) => m.sleeper_roster_id !== seat.roster_id && m.eliminated_week == null)
            .map(budgetOf),
          weeksLeft,
          history: history.map((h) => {
            const p = meta.get(h.add_slug);
            const surplus = p && p.pos ? rosValueOf({ id: p.slug, pos: p.pos, team: p.team }) - replacementOf(p.pos) : 0;
            return { surplus, bid: Number(h.bid) || 0, won: h.status === 'won', ref: startBudget };
          }),
          replacementOf,
        } : undefined;

        // Open places may be filled beyond the claim cap — those adds land at
        // once and leave nothing pending. Claims on held players (waivers)
        // stay capped at `room` below.
        const plan = seatWirePlan(slots, roster, candidates, valueOf, {
          faab,
          budget,
          openSeats,
          maxClaims: room + fills,
          rosValueOf,
          market,
        });

        let filed = 0;   // waiver claims this sweep, against `room`
        for (const c of plan) {
          // The plan is greedy and sequential: each later claim assumes the
          // earlier ones landed (its drop is a bench body in THAT lineup). So
          // a claim we will not file is not skipped over — the rest of the
          // plan is abandoned and the next sweep replans from the true state.
          if (c.onWaivers && filed >= room) break;
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
            if (c.onWaivers) filed += 1;   // filed or refused, the slot is spent this sweep
            if (ok) {
              done += 1;
              // The pool this sweep is planning against is now stale for every
              // later seat in the league, and two agent seats chasing the same
              // free agent would otherwise both "succeed" in the plan and the
              // second be refused. Cheaper to stop offering him.
              owned.add(c.add);
              const i = available.findIndex((p) => p.id === c.add);
              if (i >= 0) available.splice(i, 1);
              log('seat wire', lg.id, `${seat.kind} seat`, seat.roster_id, c.kind, c.add,
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
