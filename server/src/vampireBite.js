// ── THE SWEEP THAT LETS A VAMPIRE NOBODY MANAGES FEED (v0.427.0) ────────────
//
// Founder: "Let's have the bot vampire take a bite." The steal has always
// been the vampire's own claim to make — the app's 🩸 card — so a vampire
// seat nobody manages (a 🤖 AI seat, or an unclaimed seat tended by its
// agent) won its matchups and never fed. 0300 lets the worker call
// vampire_steal for such a seat on the wire's terms (0213/0298); the DECISION
// is core's vampireBitePlan (pure, pinned by scripts/check-vampire-bite.mjs).
// Everything here is reading the window the app reads (vampire_state), the
// two active rosters, and spending the plan through the SAME RPC a manager
// taps — so every rule it enforces (a fresh regular-season WIN, one bite per
// win, the victim's active roster, the 1-for-1 shape check both ways, the
// commissioner's steal_review) binds the bot for free, and a refused bite
// is tried again with the next-best pair rather than forced.
//
// Rides the hourly seat-wire slot in index.js: a win is fresh for a week,
// and an hour after the week finals is soon enough to bite.
import { db } from './supabase.js';
import { injuryStatusMap } from './injuries.js';
import { leagueSlotDefs, leagueGolfZeroPtsOf } from '../../packages/core/src/engine/classic.ts';
import { setLeagueGolf, clearLeagueGolf } from '../../packages/core/src/engine/golf.ts';
import { setLeagueProjScoring, clearLeagueProjScoring, leagueCatalogOf, projectedPoints } from '../../packages/core/src/engine/projScoring.ts';
import { vampireBitePlan } from '../../packages/core/src/engine/vampireBite.ts';
import { modeOfSettings } from './resolve.js';
import { seatAgentsFor } from './agents.js';

/** How many ranked pairs the sweep will offer the RPC before giving up on
 *  this win until the next hour: a cap, a stash or a roster that moved
 *  refuses a pair, never the whole idea. */
const BITE_ATTEMPTS = 5;

/** The vampire seats a league names (0268's list, else 0222's single key). */
const vampireSeatsOf = (settings) => {
  const many = settings?.vampire_rosters;
  if (Array.isArray(many)) return many.map(Number).filter(Number.isFinite);
  const one = Number(settings?.vampire_roster);
  return Number.isFinite(one) && settings?.vampire_roster !== '' && settings?.vampire_roster != null ? [one] : [];
};

/**
 * Declare a bite for every vampire seat nobody manages whose window is open.
 * Returns how many bites the RPC accepted (executed, or parked for the
 * commissioner's ruling — both are "fed").
 */
export async function sweepVampireBites(log = () => {}) {
  const { data: lgs } = await db().from('league')
    .select('id,settings_json').eq('settings_json->>format', 'vampire');
  if (!lgs?.length) return 0;

  let fed = 0;
  try {
    for (const lg of lgs) {
      const seats = vampireSeatsOf(lg.settings_json);
      if (!seats.length) continue;
      const mode = modeOfSettings(lg.settings_json);
      if (mode?.mode !== 'classic') continue;   // the bite is judged by classic slots

      // Which vampires are the worker's to feed? The wire's rule (0308): a 🤖
      // controller, account or not — or an agent row with nobody at the seat.
      const { data: mems } = await db().from('league_membership')
        .select('sleeper_roster_id,app_user_id,controller').eq('league_id', lg.id).in('sleeper_roster_id', seats);
      const agents = await seatAgentsFor([lg.id]);
      const bots = seats.filter((s) => {
        const m = (mems ?? []).find((x) => x.sleeper_roster_id === s);
        return m && (m.controller === 'ai' || (!m.app_user_id && agents.has(`${lg.id}:${s}`)));
      });
      if (!bots.length) continue;

      // THE COMMISSIONER'S SWITCH (0213): the one that says seats nobody
      // manages may transact. A bite moves two players; it is a transaction.
      const { data: on } = await db().rpc('league_agent_waivers', { p_league_id: lg.id });
      if (on === false) continue;

      // The window, as the app reads it (0300 admits the service role).
      const { data: st } = await db().rpc('vampire_state', { p_league_id: lg.id });
      const chairs = Array.isArray(st?.vampires) ? st.vampires : [];
      const open = chairs.filter((c) => bots.includes(Number(c.seat)) && c.won === true && c.fed !== true && c.victim != null);
      if (!open.length) continue;

      // Module globals, installed unconditionally (the v0.303.1 lesson).
      setLeagueGolf(mode?.golf === true, leagueGolfZeroPtsOf(mode));
      setLeagueProjScoring(leagueCatalogOf(mode));
      const slots = leagueSlotDefs(mode);
      if (!slots.length) continue;

      const { data: pool } = await db().from('league_pool').select('slug,pos,team,exp').eq('league_id', lg.id).range(0, 1999);
      const meta = new Map((pool ?? []).map((p) => [p.slug, p]));
      const { data: rows } = await db().from('native_roster').select('roster_id,slug,spot').eq('league_id', lg.id);
      const statuses = await injuryStatusMap();
      // Rest-of-season value: the season projection under the league's
      // catalog, zero for a season-ending IR — a bite is for the season.
      const rosValueOf = (p) => (statuses.get(p.id) === 'IR' ? 0
        : projectedPoints({ id: p.id, pos: p.pos ?? '', team: p.team }));
      const activeOf = (rid) => (rows ?? [])
        .filter((r) => r.roster_id === rid && (r.spot ?? 'active') === 'active')
        .map((r) => meta.get(r.slug))
        .filter((p) => p && p.pos)
        .map((p) => ({ id: p.slug, pos: p.pos, team: p.team, exp: p.exp ?? null }));

      for (const chair of open) {
        const seat = Number(chair.seat);
        const victim = Number(chair.victim);
        const plan = vampireBitePlan(slots, activeOf(seat), activeOf(victim), rosValueOf, { max: BITE_ATTEMPTS });
        if (!plan.length) { log('vampire', lg.id, 'seat', seat, 'beat', victim, 'week', st.week, '— nothing worth taking'); continue; }
        for (const b of plan) {
          try {
            const r = await db().rpc('vampire_steal',
              { p_league_id: lg.id, p_take_slug: b.take, p_give_slug: b.give, p_vampire: seat });
            if (r?.data?.ok === true) {
              fed += 1;
              log('vampire', lg.id, 'seat', seat, 'bites', victim, 'week', st.week, 'takes', b.take, 'gives', b.give,
                `(+${b.gain.toFixed(1)}/wk)`, r.data.status === 'pending' ? '— awaiting the ruling' : '');
              break;   // one bite per win
            }
            // Refused for a reason the plan cannot see (a cap, a stash, a
            // roster that moved): the next pair, then the next hour.
            log('vampire refused', lg.id, seat, b.take, 'for', b.give, r?.data?.error ?? 'no answer');
            if (/no fresh blood|already fed|no completed week|no vampire|only the vampire/.test(String(r?.data?.error ?? ''))) break;
          } catch (e) { log('vampire', lg.id, seat, b.take, e.message); break; }
        }
      }
    }
  } finally {
    clearLeagueGolf();
    clearLeagueProjScoring();
  }
  return fed;
}
