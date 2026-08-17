// SEAT AGENTS (0180): one synthetic user per unclaimed classic seat, so the
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

/** Ensure every unclaimed seat of every classic league has an agent.
 *  Returns the number of agents newly provisioned. */
export async function ensureSeatAgents() {
  const { data: lgs } = await db().from('league').select('id,settings_json');
  const classic = (lgs ?? [])
    .filter((l) => (l.settings_json?.game_mode ?? 'drip') === 'classic')
    .map((l) => l.id);
  if (!classic.length) return 0;
  const { data: seats } = await db().from('league_membership')
    .select('league_id,sleeper_roster_id').in('league_id', classic).is('app_user_id', null);
  if (!seats?.length) return 0;
  const { data: have } = await db().from('seat_agent')
    .select('league_id,roster_id').in('league_id', classic);
  const mapped = new Set((have ?? []).map((r) => `${r.league_id}:${r.roster_id}`));

  let made = 0;
  for (const s of seats) {
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
