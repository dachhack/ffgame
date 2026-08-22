// SEAT AGENTS (0180): one synthetic user per unclaimed seat, so the
// worker's auto-slot can write real sealed_pick rows for it — frozen by the
// per-player kickoff seal, rendered and scored like any manager's, and kept
// as history rather than recomputed. The mapping lives in seat_agent;
// league_membership stays NULL so every open-seat query and join flow is
// untouched, and the claim trigger (transfer_agent_lineups) hands the rows to
// whoever eventually takes the seat.
//
// Provisioning reuses the admin-API pattern seedTestUsers established: mint an
// auth user with a synthetic address, upsert the app_user row, map it. All
// three steps are idempotent, so this runs every tick and does nothing once a
// league is fully agented. A re-vacated seat finds its old agent by email and
// re-links it rather than minting users forever.
import { db } from './supabase.js';

const agentEmail = (leagueId, rosterId) => `agent-${String(leagueId).slice(0, 8)}-r${rosterId}@agents.dripfantasy.com`;

/** Ensure every unclaimed seat has an agent — DRIP LEAGUES INCLUDED (v0.339.0).
 *
 *  0180 built this for classic and stopped there, and the cost of stopping was
 *  invisible until it was measured: in the two live preseason drip leagues,
 *  EIGHT of twenty-four seats had no account and therefore no way to store a
 *  lineup at all. `sealed_pick.app_user_id` is NOT NULL, so those seats were
 *  skipped by the lock-time fill every single week and fell back to a lineup
 *  recomputed at resolve — which is what an "unopposed" window on a full
 *  league actually is. Five of Gridiron Gang's twelve seats were in that state.
 *
 *  Nothing about the DURABLE half was classic-only: the seat_agent table has no
 *  mode column, `transfer_agent_lineups` fires on any membership claim, and
 *  0213's `agent_wire_seat` never asked either. Only this provisioning filter
 *  and the fill's skip were.
 *
 *  AI SEATS ARE DELIBERATELY EXCLUDED. A seat whose controller is 'ai' is
 *  rebuilt at resolve by `aiSide`, which is where its persona draw and its
 *  bought buffs come from. Give it an agent and the lock-time fill writes rows,
 *  `sideLineup` takes its sealed-first branch instead, and the seat quietly
 *  loses both. Those seats are not missing a manager — they ARE the manager.
 *
 *  Returns the number of agents newly provisioned. */
export async function ensureSeatAgents() {
  const { data: seats } = await db().from('league_membership')
    .select('league_id,sleeper_roster_id,controller').is('app_user_id', null);
  const want = (seats ?? []).filter((s) => (s.controller ?? 'human') !== 'ai');
  if (!want.length) return 0;
  const leagueIds = [...new Set(want.map((s) => s.league_id))];
  const { data: have } = await db().from('seat_agent')
    .select('league_id,roster_id').in('league_id', leagueIds);
  const mapped = new Set((have ?? []).map((r) => `${r.league_id}:${r.roster_id}`));

  let made = 0;
  for (const s of want) {
    if (mapped.has(`${s.league_id}:${s.sleeper_roster_id}`)) continue;
    const email = agentEmail(s.league_id, s.sleeper_roster_id);
    // createUser fails on a duplicate address — which is exactly the
    // re-vacancy case, so the fallback lookup IS the reuse path.
    const { data: created } = await db().auth.admin.createUser({
      email, email_confirm: true, user_metadata: { seat_agent: true },
    });
    let uid = created?.user?.id ?? null;
    if (!uid) {
      const { data: existing } = await db().from('app_user').select('id').eq('email', email).maybeSingle();
      uid = existing?.id ?? null;
    }
    if (!uid) continue;   // auth hiccup — the next tick retries
    await db().from('app_user').upsert({ id: uid, email, display_name: 'Auto-managed' }, { onConflict: 'id' });
    const { error } = await db().from('seat_agent').upsert(
      { league_id: s.league_id, roster_id: s.sleeper_roster_id, agent_user_id: uid },
      { onConflict: 'league_id,roster_id', ignoreDuplicates: true },
    );
    if (!error) made++;
  }
  return made;
}

/** league:roster → agent uid, for the leagues given. */
export async function seatAgentsFor(leagueIds) {
  if (!leagueIds?.length) return new Map();
  const { data } = await db().from('seat_agent')
    .select('league_id,roster_id,agent_user_id').in('league_id', leagueIds);
  return new Map((data ?? []).map((r) => [`${r.league_id}:${r.roster_id}`, r.agent_user_id]));
}
